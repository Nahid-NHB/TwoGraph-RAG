# Folder Structure

```
twograph-rag/
├── package.json                 # workspace root, scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json           # strict, composite project refs
├── eslint.config.js             # flat config, import-cycle ban
├── .prettierrc.json
├── vitest.workspace.ts
├── docker-compose.yml           # memgraph + qdrant
├── .changeset/
├── .husky/
├── .github/
│   ├── workflows/ci.yml
│   ├── ISSUE_TEMPLATE/
│   └── pull_request_template.md
├── docs/                        # this documentation
├── examples/
│   └── sample-repo/             # small React+TS app used by integration tests & demos
├── packages/
│   ├── core/
│   │   └── src/{ids,config,errors,logger,types}/
│   ├── parser/
│   │   └── src/
│   │       ├── registry.ts      # language plugin registry
│   │       ├── languages/{javascript,typescript,tsx}/
│   │       └── extractors/{symbols,imports,react,routes,docs,references}/
│   ├── graph/
│   │   └── src/{client,schema,writer,queries}/
│   ├── vector/
│   │   └── src/{embedders,chunking,qdrant}/
│   ├── store/
│   │   └── src/{db,migrations,fts,repositories}/
│   ├── indexer/
│   │   └── src/{pipeline,watcher,diff}/
│   ├── retrieval/
│   │   └── src/{retrievers,fusion,rerank,context}/
│   ├── llm/
│   │   └── src/providers/{openai,anthropic,gemini,ollama,openrouter}/
│   ├── rag/
│   │   └── src/{multiquery,pipeline,grounding,chat}/
│   ├── editing/
│   │   └── src/{operations,diff,approval}/
│   ├── analysis/
│   │   └── src/{deadcode,dependencies,advisor}/
│   ├── server/
│   │   └── src/{routes,sse,plugins}/
│   ├── mcp/
│   │   └── src/tools/
│   └── cli/
│       └── src/commands/
├── apps/
│   └── web/
│       └── src/{app,features/{explorer,graph,chat,search,diff,deps},components,lib}/
└── scripts/                     # release, benchmarks, dev helpers
```

Conventions:
- Each package: `src/`, `test/` (unit beside integration under `test/integration/`), `package.json` with `exports` map, `tsconfig.json` extending base.
- Tests: `*.test.ts` (unit, no external services), `*.int.test.ts` (integration, needs docker stack).
- Internal imports via workspace protocol `"@twograph/core": "workspace:*"`.
