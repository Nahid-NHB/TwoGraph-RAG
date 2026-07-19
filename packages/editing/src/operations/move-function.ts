import { dirname, join, relative, sep } from 'node:path';
import { EditError, parseSymbolId } from '@twograph/core';
import {
  Node,
  SyntaxKind,
  type ExportSpecifier,
  type Identifier,
  type SourceFile,
  type Statement,
} from 'ts-morph';
import { z } from 'zod';
import type { EditContext, EditOperation, EditOperationResult } from '../registry.js';
import { rejectIfOverloaded, resolveTopLevelFunction } from './function-lookup.js';

export const moveFunctionParamsSchema = z.object({
  symbolId: z.string(),
  /** Repo-relative destination path — created if it doesn't already exist. */
  targetFile: z.string().min(1),
});
export type MoveFunctionParams = z.infer<typeof moveFunctionParamsSchema>;

interface ExternalDependency {
  name: string;
  declaration: Node;
}

function moduleSpecifierBetween(fromDirAbs: string, toFileAbs: string): string {
  let rel = relative(fromDirAbs, toFileAbs).split(sep).join('/');
  rel = rel.replace(/\.(tsx?|jsx?|mts|cts)$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function recalculateImportSpecifier(
  originalSpecifier: string,
  sourceFileDir: string,
  targetFileDir: string,
): string {
  if (!originalSpecifier.startsWith('.')) return originalSpecifier; // package import — path-independent
  const absoluteImported = join(sourceFileDir, originalSpecifier);
  return moduleSpecifierBetween(targetFileDir, absoluteImported);
}

/**
 * Identifiers inside `statement` that resolve to a declaration elsewhere in
 * `sourceFile` — either a sibling top-level declaration, or something
 * `sourceFile` itself imports. Imported names are matched by their local
 * binding first: `getDefinitionNodes()` follows aliases straight through to
 * the original declaration (e.g. an interface in another file entirely), so
 * relying on it alone would miss that the moved code needs an import at all.
 */
function findExternalDependencies(
  statement: Statement,
  sourceFile: SourceFile,
): ExternalDependency[] {
  const importSpecifierByLocalName = new Map<string, Node>();
  for (const imp of sourceFile.getImportDeclarations()) {
    for (const named of imp.getNamedImports()) {
      const localName = named.getAliasNode()?.getText() ?? named.getName();
      importSpecifierByLocalName.set(localName, named);
    }
  }

  const seen = new Set<string>();
  const deps: ExternalDependency[] = [];
  for (const id of statement.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = id.getText();
    if (seen.has(name)) continue;

    const importSpecifier = importSpecifierByLocalName.get(name);
    if (importSpecifier) {
      seen.add(name);
      deps.push({ name, declaration: importSpecifier });
      continue;
    }

    for (const decl of id.getDefinitionNodes()) {
      if (decl.getSourceFile() !== sourceFile) continue; // declared elsewhere already (lib/global) — nothing to do
      if (decl.getPos() >= statement.getPos() && decl.getEnd() <= statement.getEnd()) continue; // moves along with the statement
      seen.add(name);
      deps.push({ name, declaration: decl });
      break;
    }
  }
  return deps;
}

/** Adds a named import to `targetFile`, merging into an existing import from the same module. */
function addNamedImport(
  targetFile: SourceFile,
  moduleSpecifier: string,
  name: string,
  isTypeOnly = false,
): void {
  const existing = targetFile
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === moduleSpecifier && d.isTypeOnly() === isTypeOnly);
  if (existing) {
    if (!existing.getNamedImports().some((ni) => ni.getName() === name)) {
      existing.addNamedImport(name);
    }
    return;
  }
  targetFile.addImportDeclaration({ moduleSpecifier, namedImports: [name], isTypeOnly });
}

/** Resolves each dependency the moved statement needs, wiring an equivalent import into the target file. */
function wireTargetImports(
  targetFile: SourceFile,
  sourceFile: SourceFile,
  deps: ExternalDependency[],
  targetFileDir: string,
): void {
  for (const dep of deps) {
    if (Node.isImportSpecifier(dep.declaration)) {
      const importDecl = dep.declaration.getImportDeclaration();
      const moduleSpecifier = recalculateImportSpecifier(
        importDecl.getModuleSpecifierValue(),
        dirname(sourceFile.getFilePath()),
        targetFileDir,
      );
      const isTypeOnly = dep.declaration.isTypeOnly() || importDecl.isTypeOnly();
      addNamedImport(targetFile, moduleSpecifier, dep.declaration.getName(), isTypeOnly);
      continue;
    }

    // A sibling declaration staying behind in the source file — it must already
    // be exported, since the target can only import what source makes public.
    const isExported =
      (Node.isFunctionDeclaration(dep.declaration) ||
        Node.isClassDeclaration(dep.declaration) ||
        Node.isInterfaceDeclaration(dep.declaration) ||
        Node.isTypeAliasDeclaration(dep.declaration) ||
        Node.isVariableDeclaration(dep.declaration)) &&
      dep.declaration.isExported();
    if (!isExported) {
      throw new EditError(
        'EDIT_INVALID',
        `moved function depends on "${dep.name}", which is not exported from ${sourceFile.getFilePath()} — export it first or move it too`,
      );
    }
    const moduleSpecifier = moduleSpecifierBetween(targetFileDir, sourceFile.getFilePath());
    addNamedImport(targetFile, moduleSpecifier, dep.name);
  }
}

/**
 * After the statement moves out, drops any of the source file's own imports
 * it was the last user of. Checked by scanning `sourceFile`'s own remaining
 * identifiers by name rather than the project-wide reference index: the
 * moved statement's text was just relocated into another (still-mutating)
 * file, and re-resolving cross-file references mid-edit is exactly the kind
 * of staleness this side-steps.
 */
function pruneOrphanedImports(sourceFile: SourceFile, deps: ExternalDependency[]): void {
  for (const dep of deps) {
    if (!Node.isImportSpecifier(dep.declaration) || dep.declaration.wasForgotten()) continue;
    const nameNode = dep.declaration.getNameNode();
    if (!Node.isIdentifier(nameNode)) continue; // string-named import specifier — leave it alone
    const localName = nameNode.getText();
    const stillUsed = sourceFile
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .some((id) => id !== nameNode && id.getText() === localName);
    if (stillUsed) continue;
    const importDecl = dep.declaration.getImportDeclaration();
    dep.declaration.remove();
    if (
      importDecl.getNamedImports().length === 0 &&
      !importDecl.getDefaultImport() &&
      !importDecl.getNamespaceImport()
    ) {
      importDecl.remove();
    }
  }
}

/** Re-points every other file's import/re-export of the moved name at its new home. */
function repointImporters(
  importerRefs: Identifier[],
  sourceFile: SourceFile,
  targetFile: SourceFile,
): void {
  for (const ref of importerRefs) {
    const specifier = ref.getParent();
    const importerFile = ref.getSourceFile();

    if (Node.isImportSpecifier(specifier)) {
      const decl = specifier.getImportDeclaration();
      const name = specifier.getName();
      const alias = specifier.getAliasNode()?.getText();
      const recalculated = moduleSpecifierBetween(
        dirname(importerFile.getFilePath()),
        targetFile.getFilePath(),
      );

      specifier.remove();
      if (
        decl.getNamedImports().length === 0 &&
        !decl.getDefaultImport() &&
        !decl.getNamespaceImport()
      ) {
        decl.remove();
      }

      addNamedImport(importerFile, recalculated, name);
      if (alias) {
        importerFile
          .getImportDeclarations()
          .flatMap((d) => d.getNamedImports())
          .find((ni) => ni.getName() === name && !ni.getAliasNode())
          ?.setAlias(alias);
      }
      continue;
    }

    if (Node.isExportSpecifier(specifier)) {
      repointExportSpecifier(specifier, importerFile, targetFile);
    }
  }
}

function repointExportSpecifier(
  specifier: ExportSpecifier,
  importerFile: SourceFile,
  targetFile: SourceFile,
): void {
  const decl = specifier.getExportDeclaration();
  const alias = specifier.getAliasNode()?.getText();
  const name = specifier.getName();
  const recalculated = moduleSpecifierBetween(
    dirname(importerFile.getFilePath()),
    targetFile.getFilePath(),
  );

  specifier.remove();
  if (decl.getNamedExports().length === 0) decl.remove();

  const existing = importerFile
    .getExportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === recalculated);
  if (existing) {
    existing.addNamedExport(alias ? { name, alias } : name);
  } else {
    importerFile.addExportDeclaration({
      moduleSpecifier: recalculated,
      namedExports: [alias ? { name, alias } : name],
    });
  }
}

/**
 * Moves a top-level function to another file (issue #52, docs/08 §2): the
 * declaration is transplanted, its own dependencies get recalculated
 * imports in the target, every importer (including barrel re-exports) is
 * re-pointed at the new location, and any of the source file's imports left
 * with no remaining user are pruned.
 */
export const moveFunction: EditOperation<MoveFunctionParams> = {
  id: 'move_function',
  paramsSchema: moveFunctionParamsSchema,
  entryPaths: (params) => [parseSymbolId(params.symbolId).path, params.targetFile],
  plan(ctx: EditContext, params: MoveFunctionParams): EditOperationResult {
    const { path, qualifiedName } = parseSymbolId(params.symbolId);
    if (qualifiedName.includes('.')) {
      throw new EditError('EDIT_INVALID', 'move_function only supports top-level functions');
    }
    if (path === params.targetFile) {
      throw new EditError('EDIT_INVALID', "targetFile is the same as the symbol's current file");
    }

    const sourceFile = ctx.project.getSourceFileOrThrow(join(ctx.rootPath, path));
    const { fn, nameNode, statement } = resolveTopLevelFunction(sourceFile, qualifiedName);
    rejectIfOverloaded(fn, qualifiedName);

    const targetAbsPath = join(ctx.rootPath, params.targetFile);
    const targetFile =
      ctx.project.getSourceFile(targetAbsPath) ??
      ctx.project.createSourceFile(targetAbsPath, '', { overwrite: false });

    if (targetFile.getLocals().some((l) => l.getName() === qualifiedName)) {
      throw new EditError(
        'EDIT_INVALID',
        `"${qualifiedName}" is already declared at the top level of ${params.targetFile}`,
      );
    }

    const deps = findExternalDependencies(statement, sourceFile);
    const importerRefs = nameNode
      .findReferencesAsNodes()
      .filter((ref): ref is Identifier => ref !== nameNode && Node.isIdentifier(ref))
      .filter((ref) => ref.getSourceFile() !== sourceFile);

    const movedText = statement.getFullText().trim();
    statement.remove();

    targetFile.addStatements(movedText);
    wireTargetImports(targetFile, sourceFile, deps, dirname(targetAbsPath));
    pruneOrphanedImports(sourceFile, deps);
    repointImporters(importerRefs, sourceFile, targetFile);

    return { affectedSymbols: [params.symbolId] };
  },
};
