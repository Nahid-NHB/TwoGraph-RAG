# TwoGraph-RAG

> AI-powered code intelligence for JavaScript, TypeScript, and React codebases — AST parsing, knowledge graphs, hybrid semantic search, and grounded RAG in one platform.

**Status: 🚧 Design phase.** Architecture is documented, implementation is tracked in [GitHub issues & milestones](../../issues).

## What is it?

TwoGraph-RAG analyzes entire repositories with Tree-sitter, builds a persistent knowledge graph in Memgraph, indexes code semantically with UniXcoder embeddings, and answers complex developer questions through a hybrid retrieval pipeline (BM25 + vectors + graph traversal → RRF → cross-encoder reranking). It can also **edit code safely via AST transformations** with diff previews and approval gates, and it keeps itself up to date as files change.

Think _Sourcegraph Cody + Greptile + GraphRAG + Cursor_, focused on the JS/TS/React ecosystem, fully open source.

```
Question → Multi-Query → Hybrid Search → Graph Expansion → RRF → Rerank → Context Assembly → LLM → Grounded Answer
```

## Capabilities (planned)

- **Whole-repo understanding** — functions, classes, hooks, components, props, contexts, routes, API handlers, imports/exports, tests, configs
- **Knowledge graph** — 20+ node types, 20+ edge types (CALLS, IMPORTS, USES_HOOK, PROVIDES_CONTEXT, …), incrementally updated, never rebuilt from scratch
- **Semantic search** — "authentication" finds `verifyToken()`, `validateJWT()`, `login()` even when the word never appears
- **Grounded answers** — every answer cites files, functions, snippets, and graph paths
- **AST-based editing** — rename, move, extract, parameter changes; never regex; approval required before writes
- **Dead code & dependency analysis** — reachability from entry points, full dependency graph from package.json/tsconfig/bundler configs
- **Real-time indexing** — filesystem watcher reparses and updates graph + embeddings incrementally
- **MCP server** — `query_graph`, `semantic_search`, `edit_function`, `call_hierarchy`, `dead_code`, and more
- **Modern web UI** — repository explorer, graph visualization, chat, diff viewer, dependency explorer, dark mode
- **Interchangeable LLMs** — Gemini, OpenAI, Anthropic, Ollama, OpenRouter

## Documentation

| Doc                                                 | Contents                                  |
| --------------------------------------------------- | ----------------------------------------- |
| [Requirements](docs/01-requirements.md)             | Functional & non-functional requirements  |
| [Architecture](docs/02-architecture.md)             | Components, package layout, data flow     |
| [Folder Structure](docs/03-folder-structure.md)     | Monorepo layout                           |
| [Database Schema](docs/04-database-schema.md)       | SQLite metadata store, Qdrant collections |
| [Knowledge Graph Schema](docs/05-graph-schema.md)   | Node labels, edge types, Cypher patterns  |
| [API Design](docs/06-api-design.md)                 | REST/SSE API, MCP tools, CLI              |
| [Retrieval Pipeline](docs/07-retrieval-pipeline.md) | Hybrid retrieval + RAG pipeline           |
| [Editing Pipeline](docs/08-editing-pipeline.md)     | AST editing with approval workflow        |
| [Extension Points](docs/09-extension-points.md)     | Plugging in languages, stores, providers  |

## MCP server

`@twograph/mcp` exposes the index to any MCP-compatible agent (Claude Code, Claude Desktop, Cursor, …) via `repository_summary`, `semantic_search`, `query_graph`, `edit_function`, and `optimize_function`. Index a repo first (`twograph init && twograph index`), then run:

```bash
twograph mcp             # stdio (default) — for clients that spawn a child process
twograph mcp --http      # streamable HTTP on :4802 (POST/GET/DELETE http://localhost:4802/mcp)
```

**Claude Code**: `claude mcp add twograph -- twograph mcp`

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "twograph": {
      "command": "twograph",
      "args": ["mcp"]
    }
  }
}
```

Every tool takes a `repo` argument — the absolute path to an already-indexed repository root.

## Development

```bash
pnpm install
docker compose up -d   # Memgraph + Qdrant
pnpm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Work is organized into 10 milestones; every change lands as one PR closing one issue.

## License

MIT
