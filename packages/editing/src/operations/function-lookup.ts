import { EditError } from '@twograph/core';
import {
  Node,
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Identifier,
  type SourceFile,
  type Statement,
} from 'ts-morph';

export type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

export interface ResolvedFunction {
  fn: FunctionLike;
  /** The identifier callers reference — the function's own name, or the `const` it's bound to. */
  nameNode: Identifier;
  /** The top-level statement to remove/relocate whole: the FunctionDeclaration itself, or the const's VariableStatement. */
  statement: Statement;
}

/**
 * Resolves a top-level `function foo() {}` or `const foo = () => {}` /
 * `const foo = function () {}` declaration by name. Shared by the signature-
 * editing operations (add/remove parameter, move_function, and future ones).
 */
export function resolveTopLevelFunction(sourceFile: SourceFile, name: string): ResolvedFunction {
  const fn = sourceFile.getFunction(name);
  if (fn) {
    const nameNode = fn.getNameNode();
    if (!nameNode) {
      throw new EditError('EDIT_INVALID', `function "${name}" has no name node`);
    }
    return { fn, nameNode, statement: fn };
  }

  const variable = sourceFile.getVariableDeclaration(name);
  if (variable) {
    const initializer = variable.getInitializer();
    if (
      initializer &&
      (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
    ) {
      const nameNode = variable.getNameNode();
      if (Node.isIdentifier(nameNode)) {
        return { fn: initializer, nameNode, statement: variable.getVariableStatementOrThrow() };
      }
    }
  }

  throw new EditError(
    'EDIT_INVALID',
    `no top-level function named "${name}" in ${sourceFile.getFilePath()}`,
  );
}

/**
 * Signature edits (add/remove parameter) don't attempt to keep multiple
 * overload signatures in sync — reject with a clear reason rather than
 * silently editing just one and leaving the others stale.
 */
export function rejectIfOverloaded(fn: FunctionLike, qualifiedName: string): void {
  if (Node.isFunctionDeclaration(fn) && (fn.isOverload() || fn.getOverloads().length > 0)) {
    throw new EditError(
      'EDIT_INVALID',
      `"${qualifiedName}" has overload signatures — signature edits aren't supported for overloaded functions`,
    );
  }
}

/** Every call expression that invokes (not merely references) this function, project-wide. */
export function findCallSites(nameNode: Identifier): CallExpression[] {
  const calls: CallExpression[] = [];
  for (const ref of nameNode.findReferencesAsNodes()) {
    const parent = ref.getParent();
    if (Node.isCallExpression(parent) && parent.getExpression() === ref) {
      calls.push(parent);
    }
  }
  return calls;
}
