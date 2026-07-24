# @twograph/core

## 0.1.0

### Minor Changes

- [#83](https://github.com/Nahid-NHB/TwoGraph-RAG/pull/83) [`0567f7a`](https://github.com/Nahid-NHB/TwoGraph-RAG/commit/0567f7a28fb03e9bc92ccbb8b624b0f79618c4af) Thanks [@Nahid-NHB](https://github.com/Nahid-NHB)! - First public release.

  - Whole-repo parsing (Tree-sitter) into a persistent Memgraph knowledge graph — 20+ node/edge types, incrementally updated.
  - Hybrid retrieval (BM25 + vector + graph traversal → RRF → cross-encoder rerank) and a grounded RAG pipeline with verifiable citations.
  - AST-based code editing (rename, move, extract, parameter changes) with diff previews and an approval workflow — never regex.
  - Dead-code and dependency analysis (reachability from entry points, package.json/tsconfig/bundler config parsing).
  - Real-time incremental indexing via a filesystem watcher.
  - Content-hash embedding cache (survives restarts) and generation-keyed LRU caching for hot graph queries and RAG search/multi-query.
  - REST API + SSE streaming, an MCP server (`repository_summary`, `semantic_search`, `query_graph`, `call_hierarchy`, `component_usage`, `dependency_graph`, `dead_code`, `edit_function`, `optimize_function`), and a CLI (`init`, `index`, `search`, `query`, `graph`, `deadcode`, `deps`, `optimize`, `serve`, `mcp`).
  - A web UI: repository explorer, graph visualization, call/component hierarchy trees, chat, diff viewer, dependency explorer, dark mode.
  - Interchangeable LLM providers (Anthropic, OpenAI, Gemini, Ollama, OpenRouter) and embedders (local ONNX or API-based).
  - A benchmark suite (`pnpm bench`) tracking indexing throughput/latency and retrieval quality against a committed baseline, gated in CI.
  - A release-gate end-to-end test (index → search → ask → edit) required on every change.
