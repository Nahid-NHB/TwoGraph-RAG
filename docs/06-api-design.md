# API Design

Three surfaces share the same service layer: REST/SSE (Fastify), MCP, CLI. All request/response shapes are zod schemas exported from `@twograph/core` (single source of truth, reused by the web client).

## 1. REST API (`@twograph/server`, default `:4801`)

Errors: RFC 7807 `application/problem+json`. IDs are stable symbol IDs. All list endpoints paginate (`limit`/`cursor`).

### Repositories & indexing
| Method | Path | Description |
| --- | --- | --- |
| POST | `/v1/repos` | register repo `{rootPath, name}` |
| GET | `/v1/repos` / `/v1/repos/:repo` | list / detail (+ index stats) |
| POST | `/v1/repos/:repo/index` | start indexing `{rebuild?: boolean}` → `{runId}` |
| GET | `/v1/repos/:repo/index/runs/:runId` | run status/progress |
| POST | `/v1/repos/:repo/watch` | `{enabled: boolean}` toggle watcher |
| GET | `/v1/repos/:repo/summary` | generated repository summary |

### Search & graph
| Method | Path | Description |
| --- | --- | --- |
| POST | `/v1/repos/:repo/search` | hybrid search `{query, k?, filters?{kinds,pathGlob,language}, mode?: hybrid\|semantic\|keyword}` → ranked hits with snippets |
| GET | `/v1/repos/:repo/symbols/:id` | symbol detail: code, signature, doc, neighbors |
| GET | `/v1/repos/:repo/symbols/:id/callers` `/callees` | call hierarchy `?depth=1..5` |
| GET | `/v1/repos/:repo/components/:id/usage` | component usage tree |
| POST | `/v1/repos/:repo/graph/query` | safe parameterized Cypher templates `{template, params}` (raw Cypher behind `allowRawCypher` config) |
| GET | `/v1/repos/:repo/graph/subgraph` | `?root=&edges=&depth=` for visualization |
| GET | `/v1/repos/:repo/files/tree` | explorer tree |
| GET | `/v1/repos/:repo/deps` | dependency graph |
| GET | `/v1/repos/:repo/deadcode` | dead-code report `?entry=...` |

### Chat (RAG)
| Method | Path | Description |
| --- | --- | --- |
| POST | `/v1/repos/:repo/chat/sessions` | create session |
| POST | `/v1/repos/:repo/chat/sessions/:sid/messages` | ask; `Accept: text/event-stream` streams |
| GET | `/v1/repos/:repo/chat/sessions/:sid` | history with citations |

SSE events: `stage` (pipeline progress: multiquery→search→rerank→generate), `token`, `citations`, `done`, `error`.

### Edits
| Method | Path | Description |
| --- | --- | --- |
| POST | `/v1/repos/:repo/edits` | propose `{operation, params}` → `{editId, diff, affectedFiles}` |
| GET | `/v1/repos/:repo/edits` / `/edits/:id` | list / preview |
| POST | `/v1/repos/:repo/edits/:id/approve` | apply atomically, trigger reindex |
| POST | `/v1/repos/:repo/edits/:id/reject` | discard |
| POST | `/v1/repos/:repo/edits/:id/revert` | restore pre-images |
| POST | `/v1/repos/:repo/optimize` | `{symbolId}` → suggestions (optionally as pending edits) |

## 2. MCP tools (`@twograph/mcp`, stdio + streamable HTTP)

| Tool | Input (abridged) | Output |
| --- | --- | --- |
| `repository_summary` | `{repo}` | overview: stacks, entry points, key modules |
| `semantic_search` | `{repo, query, k?, filters?}` | ranked symbols + snippets |
| `query_graph` | `{repo, template, params}` | rows |
| `call_hierarchy` | `{repo, symbol, direction, depth?}` | tree |
| `component_usage` | `{repo, component}` | usage tree |
| `dependency_graph` | `{repo, scope?}` | graph JSON |
| `dead_code` | `{repo, entryPoints?}` | report |
| `edit_function` | `{repo, operation, params, apply?: false}` | diff preview; `apply` only after preview, mirrors approval gate |
| `optimize_function` | `{repo, symbol, guidelines?}` | suggestions + optional diff |

## 3. CLI (`twograph`)

```
twograph init                      # write .twograph/config.json
twograph index [path] [--rebuild] [--watch]
twograph search <query> [-k 10] [--kind function] [--json]
twograph query "<natural language question>"    # full RAG in terminal
twograph graph <template> [--param k=v]
twograph deadcode [--entry src/main.tsx]
twograph serve [--port 4801]      # REST API
twograph mcp [--http]             # MCP server (stdio default)
```

## 4. Configuration (`.twograph/config.json` + env)

```jsonc
{
  "llm": { "provider": "anthropic", "model": "claude-sonnet-5", "apiKeyEnv": "ANTHROPIC_API_KEY" },
  "embedder": { "provider": "unixcoder-onnx" },
  "memgraph": { "uri": "bolt://localhost:7687" },
  "qdrant": { "url": "http://localhost:6333" },
  "index": { "ignore": ["**/dist/**"], "entryPoints": ["src/main.tsx"] },
  "retrieval": { "k": 12, "rrfK": 60, "rerank": true },
  "editing": { "requireApproval": true },
  "guidelinesFile": ".twograph/guidelines.md"
}
```
