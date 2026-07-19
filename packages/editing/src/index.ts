export { loadScopedProject } from './project.js';
export { assertParsesCleanly, assertProjectParsesCleanly } from './diagnostics.js';
export { snapshotProject, buildEditPlan, type EditPlan, type ProjectSnapshot } from './plan.js';
export {
  EditOperationRegistry,
  type EditContext,
  type EditOperation,
  type EditOperationResult,
} from './registry.js';
export { planEdit, type PlanEditDeps } from './engine.js';
export { writeFilesAtomically } from './apply.js';
export {
  proposeEdit,
  approveEdit,
  rejectEdit,
  revertEdit,
  DEFAULT_EDIT_EXPIRY_MS,
  type ProposeEditDeps,
  type ApproveEditDeps,
} from './approval.js';
export {
  renameSymbol,
  renameSymbolParamsSchema,
  type RenameSymbolParams,
} from './operations/rename-symbol.js';
export {
  addParameter,
  addParameterParamsSchema,
  type AddParameterParams,
} from './operations/add-parameter.js';
export {
  removeParameter,
  removeParameterParamsSchema,
  type RemoveParameterParams,
} from './operations/remove-parameter.js';
export {
  moveFunction,
  moveFunctionParamsSchema,
  type MoveFunctionParams,
} from './operations/move-function.js';
