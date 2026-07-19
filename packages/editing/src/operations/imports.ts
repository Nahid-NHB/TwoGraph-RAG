import type { SourceFile } from 'ts-morph';

/**
 * Adds a named import to `sourceFile`, merging into an existing import from
 * the same module rather than creating a duplicate `import` statement.
 * Shared by every operation that needs to wire up an import (move_function,
 * update_imports, and future ones — issue #54).
 */
export function addNamedImport(
  sourceFile: SourceFile,
  moduleSpecifier: string,
  name: string,
  isTypeOnly = false,
): void {
  const existing = sourceFile
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === moduleSpecifier && d.isTypeOnly() === isTypeOnly);
  if (existing) {
    if (!existing.getNamedImports().some((ni) => ni.getName() === name)) {
      existing.addNamedImport(name);
    }
    return;
  }
  sourceFile.addImportDeclaration({ moduleSpecifier, namedImports: [name], isTypeOnly });
}
