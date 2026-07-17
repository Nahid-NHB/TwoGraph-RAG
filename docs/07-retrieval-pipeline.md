# Retrieval & RAG Pipeline

```
Question
  → Multi-Query Generation
  → Hybrid Search (BM25 ∥ Vector ∥ Graph)
  → Graph Expansion
  → Reciprocal Rank Fusion
  → Cross-Encoder Reranking
  → Context Assembly
  → LLM
  → Grounded Answer (citations)
```

## 1. Multi-query generation
Small/fast LLM call rewrites the question into 2–4 diverse queries: literal keyword form, semantic paraphrase, symbol-guess form (`"auth" → verifyToken, validateJWT`), plus optional graph intent (detected patterns like *who calls X*, *unused Y*, *depends on Z* route straight to graph templates). Failure-safe: on LLM error, fall back to the original question only.

## 2. Retrievers (run in parallel per query)
- **BM25** — SQLite FTS5 `bm25()` over chunk content + boosted `name`/`path` columns. Exact identifiers win here.
- **Vector** — UniXcoder embedding of the query → Qdrant cosine top-k with payload filters (kind/path/language). Intent matching wins here.
- **Graph** — intent templates (callers/callees/usage/deps/dead-code) or name-anchored seeds; returns symbols with their graph paths.

Each returns `RankedList<{symbolId, score, source, graphPath?}>`.

## 3. Graph expansion
Top-N seeds from BM25+vector are expanded 1–2 hops along `CALLS`, `USES_COMPONENT`, `USES_HOOK`, `IMPORTS`, `PROVIDES_CONTEXT/CONSUMES_CONTEXT`. Expanded nodes join the candidate pool with decayed scores (`score × 0.6^hops`). This is what lets "show payment flow" pull the whole chain, not just the best-matching function.

## 4. Fusion — Reciprocal Rank Fusion
`RRF(d) = Σ_lists 1 / (k + rank_list(d))`, k = 60 (configurable). Ranks only — no score normalization across heterogeneous retrievers. Dedup by symbolId, keep best graphPath.

## 5. Reranking — cross-encoder
Top ~50 fused candidates scored pairwise `(question, chunk)` by a cross-encoder (ms-marco-MiniLM class, ONNX local). Optional (config `retrieval.rerank`); skipped in latency-sensitive paths.

## 6. Context assembly (token-budgeted)
For each surviving symbol, in priority order until budget (default 12k tokens):
1. signature + docstring (always)
2. full code (trimmed to symbol span)
3. caller hierarchy (2 levels, signatures only)
4. callee hierarchy (2 levels, signatures only)
5. related files (same-dir siblings, co-imported modules — names only)

Deduplicated by file span; each block tagged `[S1] path:lines` for citation.

## 7. Generation & grounding
System prompt requires: answer only from context; cite every claim as `[S#]`; say "not enough context" instead of guessing. Post-processing maps `[S#]` → `{file, symbolId, lines, graphPath}` returned as structured citations and rendered as links in UI/CLI. Streaming end-to-end (SSE).

## 8. Evaluation hooks
Golden-question set over `examples/sample-repo` (question → expected files/symbols); recall@k and citation-precision tracked in benchmark CI to catch retrieval regressions.
