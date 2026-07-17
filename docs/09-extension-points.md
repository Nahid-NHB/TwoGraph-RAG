# Extension Points

Every subsystem hides behind a small interface registered in a registry. Adding a capability = implement interface + register; no pipeline changes.

## 1. Language parsers
```ts
interface LanguagePlugin {
  id: string;                              // "typescript"
  extensions: string[];                    // [".ts", ".mts"]
  grammar(): Promise<TreeSitterLanguage>;
  extractors: Extractor[];                 // symbol/import/react/route/doc extractors
}
```
Future: Python, Go, Rust plug in here; graph schema already language-neutral (`kind` is data, not code).

## 2. Embedding providers
```ts
interface Embedder {
  id: string;                              // "unixcoder-onnx" — used to namespace the Qdrant collection
  dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
```
Ship UniXcoder/ONNX; API-based embedders (OpenAI, Voyage) are drop-ins. Collection-per-embedder means switching never mixes vector spaces.

## 3. Vector stores
`VectorStore { upsert, search(vector, filters), deleteBySymbolIds }` — Qdrant default; pgvector/LanceDB implementable without touching retrieval.

## 4. Retrievers
`Retriever { id, retrieve(query, opts): RankedList }` — RRF consumes any number of registered retrievers, so adding e.g. a git-history retriever or symbol-name trigram retriever is additive.

## 5. LLM providers
`LlmProvider { id, complete(req), stream(req) }` with normalized messages/tool-calls; Gemini/OpenAI/Anthropic/Ollama/OpenRouter included.

## 6. Edit operations
`EditOperation<P> { id, paramsSchema: zod, plan(ctx, params): EditPlan }` — registry-driven; MCP/REST expose registered ops automatically.

## 7. Analyzers & advisors
`Analyzer { id, analyze(repo): Findings }` — dead-code and dependency analysis are the first two; rule packs for the optimization advisor load from config (`.twograph/guidelines.md` + built-in React/TS packs).

## 8. Route/framework detectors
Route extraction is convention-plugin based (`next-app-router`, `next-pages`, `express`, `react-router`); new frameworks (Remix, Hono) are one detector file.

## 9. Planned future work (non-goals for v0.x)
- Multi-repo / cross-repo graph queries
- Git history nodes (commits, authors, blame edges)
- Remote indexing workers & horizontal scaling
- Editor extensions (VS Code) speaking to the same API
- AuthN/Z for multi-user deployments
