import { join } from 'node:path';
import { EditError } from '@twograph/core';
import { Node, SyntaxKind, type SourceFile, type Statement } from 'ts-morph';
import { z } from 'zod';
import type { EditContext, EditOperation, EditOperationResult } from '../registry.js';

export const extractFunctionParamsSchema = z.object({
  file: z.string().min(1),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  name: z
    .string()
    .min(1)
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, 'must be a valid identifier'),
});
export type ExtractFunctionParams = z.infer<typeof extractFunctionParamsSchema>;

const LEAK_KINDS = [
  SyntaxKind.ReturnStatement,
  SyntaxKind.BreakStatement,
  SyntaxKind.ContinueStatement,
] as const;

interface SelectedSpan {
  statements: Statement[];
  /** The top-level (source-file-direct-child) statement the span lives inside — where the extracted function gets inserted before. */
  enclosingTopLevelStatement: Statement;
}

/** Finds the contiguous run of a top-level function's block statements whose lines fall within [startLine, endLine]. */
function selectSpan(
  sourceFile: SourceFile,
  startLine: number,
  endLine: number,
): SelectedSpan | undefined {
  for (const topLevel of sourceFile.getStatements()) {
    let body: Node | undefined;
    if (Node.isFunctionDeclaration(topLevel)) {
      body = topLevel.getBody();
    } else if (Node.isVariableStatement(topLevel)) {
      for (const decl of topLevel.getDeclarations()) {
        const init = decl.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          body = init.getBody();
        }
      }
    }
    if (!body || !Node.isBlock(body)) continue;

    const statements = body
      .getStatements()
      .filter((s) => s.getStartLineNumber() >= startLine && s.getEndLineNumber() <= endLine);
    if (statements.length > 0) return { statements, enclosingTopLevelStatement: topLevel };
  }
  return undefined;
}

/** Rejects spans containing a return/break/continue — extracting them would change control flow. */
function assertNoControlFlowLeak(statements: Statement[]): void {
  for (const statement of statements) {
    for (const kind of LEAK_KINDS) {
      if (statement.getKind() === kind || statement.getDescendantsOfKind(kind).length > 0) {
        throw new EditError(
          'EDIT_INVALID',
          `selected span contains a ${SyntaxKind[kind]} — extracting it would change control flow`,
        );
      }
    }
  }
}

interface FlowAnalysis {
  /** External variables read in the span — become parameters, in first-seen order. */
  params: { name: string; typeText: string }[];
  /** Variables the span must hand back to the caller, in first-seen order. */
  returns: { name: string; typeText: string; isNewDeclaration: boolean }[];
}

/** Data-flow analysis over the selected span (issue #53, docs/08 §2). */
function analyzeFlow(statements: Statement[], sourceFile: SourceFile): FlowAnalysis {
  const spanStart = statements[0]!.getStart();
  const spanEnd = statements[statements.length - 1]!.getEnd();
  const parentBody = statements[0]!.getParentOrThrow();
  const afterStatements = Node.isBlock(parentBody)
    ? parentBody.getStatements().filter((s) => s.getStart() >= spanEnd)
    : [];

  const declaredInSpan = new Set<string>();
  const declaredInSpanTypes = new Map<string, string>();
  for (const statement of statements) {
    for (const decl of statement.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const nameNode = decl.getNameNode();
      if (Node.isIdentifier(nameNode)) {
        declaredInSpan.add(nameNode.getText());
        declaredInSpanTypes.set(nameNode.getText(), decl.getType().getText());
      }
    }
  }

  const paramNames: string[] = [];
  const paramTypes = new Map<string, string>();
  const writtenInSpan = new Set<string>();
  const seenParam = new Set<string>();

  for (const statement of statements) {
    for (const id of statement.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const name = id.getText();
      if (declaredInSpan.has(name)) continue; // local to the extracted code

      const parent = id.getParent();
      // `foo` in `obj.foo` is a member name, not a standalone variable reference.
      if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) continue;

      const isWriteTarget =
        (Node.isBinaryExpression(parent) &&
          parent.getOperatorToken().getText() === '=' &&
          parent.getLeft() === id) ||
        (Node.isPostfixUnaryExpression(parent) && parent.getOperand() === id) ||
        (Node.isPrefixUnaryExpression(parent) && parent.getOperand() === id);
      if (isWriteTarget) writtenInSpan.add(name);

      // Only declarations inside this same file count as "captured" — a
      // reference resolving to a lib/global .d.ts declaration (console,
      // Math, ...) needs no parameter at all.
      const isExternal = id
        .getDefinitionNodes()
        .some(
          (decl) =>
            decl.getSourceFile() === sourceFile &&
            (decl.getStart() < spanStart || decl.getStart() >= spanEnd),
        );
      if (!isExternal) continue;

      if (!seenParam.has(name)) {
        seenParam.add(name);
        paramNames.push(name);
        paramTypes.set(name, id.getType().getText());
      }
    }
  }

  const readAfter = new Set<string>();
  for (const statement of afterStatements) {
    for (const id of statement.getDescendantsOfKind(SyntaxKind.Identifier)) {
      readAfter.add(id.getText());
    }
  }

  const returns: FlowAnalysis['returns'] = [];
  const seenReturn = new Set<string>();
  for (const name of writtenInSpan) {
    if (!readAfter.has(name) || seenReturn.has(name)) continue;
    seenReturn.add(name);
    returns.push({ name, typeText: paramTypes.get(name) ?? 'unknown', isNewDeclaration: false });
  }
  for (const name of declaredInSpan) {
    if (!readAfter.has(name) || seenReturn.has(name)) continue;
    seenReturn.add(name);
    returns.push({
      name,
      typeText: declaredInSpanTypes.get(name) ?? 'unknown',
      isNewDeclaration: true,
    });
  }

  if (returns.some((r) => r.isNewDeclaration) && returns.some((r) => !r.isNewDeclaration)) {
    throw new EditError(
      'EDIT_INVALID',
      'extract_function cannot mix newly-declared and pre-existing output variables in one extraction',
    );
  }

  const params = paramNames.map((name) => ({ name, typeText: paramTypes.get(name) ?? 'unknown' }));
  return { params, returns };
}

function buildExtractedFunction(name: string, statements: Statement[], flow: FlowAnalysis): string {
  const paramList = flow.params.map((p) => `${p.name}: ${p.typeText}`).join(', ');
  const body = statements.map((s) => s.getText()).join('\n  ');
  const returnStatement =
    flow.returns.length === 0
      ? ''
      : flow.returns.length === 1
        ? `\n  return ${flow.returns[0]!.name};`
        : `\n  return { ${flow.returns.map((r) => r.name).join(', ')} };`;
  const returnType =
    flow.returns.length === 0
      ? 'void'
      : flow.returns.length === 1
        ? flow.returns[0]!.typeText
        : `{ ${flow.returns.map((r) => `${r.name}: ${r.typeText}`).join('; ')} }`;

  return `function ${name}(${paramList}): ${returnType} {\n  ${body}${returnStatement}\n}\n`;
}

function buildCallSite(name: string, flow: FlowAnalysis): string {
  const args = flow.params.map((p) => p.name).join(', ');
  const call = `${name}(${args})`;
  if (flow.returns.length === 0) return `${call};`;
  if (flow.returns.length === 1) {
    const ret = flow.returns[0]!;
    return ret.isNewDeclaration ? `const ${ret.name} = ${call};` : `${ret.name} = ${call};`;
  }
  const names = flow.returns.map((r) => r.name).join(', ');
  const isNewDeclaration = flow.returns[0]!.isNewDeclaration;
  return isNewDeclaration ? `const { ${names} } = ${call};` : `({ ${names} } = ${call});`;
}

/**
 * Extracts a contiguous statement span into a new top-level function (issue
 * #53, docs/08 §2): captured variables become parameters, variables written
 * in the span and read afterward become returns, and a call replaces the
 * original statements. Spans containing a `return`/`break`/`continue` are
 * rejected outright — extracting them would silently change control flow.
 */
export const extractFunction: EditOperation<ExtractFunctionParams> = {
  id: 'extract_function',
  paramsSchema: extractFunctionParamsSchema,
  entryPaths: (params) => [params.file],
  plan(ctx: EditContext, params: ExtractFunctionParams): EditOperationResult {
    const sourceFile = ctx.project.getSourceFileOrThrow(join(ctx.rootPath, params.file));

    if (sourceFile.getFunction(params.name) || sourceFile.getVariableDeclaration(params.name)) {
      throw new EditError(
        'EDIT_INVALID',
        `"${params.name}" is already declared at the top level of ${params.file}`,
      );
    }

    const span = selectSpan(sourceFile, params.startLine, params.endLine);
    if (!span) {
      throw new EditError(
        'EDIT_INVALID',
        `no statements found in ${params.file} between lines ${String(params.startLine)}-${String(params.endLine)}`,
      );
    }
    const { statements, enclosingTopLevelStatement } = span;
    assertNoControlFlowLeak(statements);

    const flow = analyzeFlow(statements, sourceFile);
    const extractedFunctionText = buildExtractedFunction(params.name, statements, flow);
    const callSiteText = buildCallSite(params.name, flow);

    const insertIndex = sourceFile.getStatements().indexOf(enclosingTopLevelStatement);

    statements[0]!.replaceWithText(callSiteText);
    for (let i = statements.length - 1; i >= 1; i--) statements[i]!.remove();

    sourceFile.insertStatements(Math.max(insertIndex, 0), extractedFunctionText);

    return { affectedSymbols: [] };
  },
};
