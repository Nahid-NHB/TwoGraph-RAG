export {
  findDeadCode,
  deadCodeReportSchema,
  deadCodeSymbolSchema,
  deadCodeFileSchema,
  deadCodeConfidenceSchema,
  type DeadCodeReport,
  type FindDeadCodeOptions,
} from './deadcode/index.js';
export {
  analyzeDependencies,
  findDependencyMismatches,
  writeDependencyGraph,
  dependencyReportSchema,
  dependencyMismatchSchema,
  dependencyNodeSchema,
  packageNodeSchema,
  configurationNodeSchema,
  type DependencyReport,
  type DependencyMismatch,
  type DependencyGraphSummary,
} from './dependencies/index.js';
