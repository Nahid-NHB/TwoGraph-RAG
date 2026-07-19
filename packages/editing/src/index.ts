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
