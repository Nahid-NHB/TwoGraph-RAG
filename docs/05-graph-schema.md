# Knowledge Graph Schema (Memgraph)

Cypher-compatible property graph. Every code node carries `id` (stable symbol ID), `repoId`, `path`, `name`, and location (`startLine`, `endLine`). Uniqueness constraint on `id` per label; indexes on `(repoId)`, `(name)`, `(kind)`.

## 1. Node labels

| Label | Extra properties | Notes |
| --- | --- | --- |
| `Repository` | `rootPath`, `name` | one per indexed repo |
| `Package` | `version`, `manifestPath` | from package.json (workspace-aware) |
| `Directory` | — | |
| `File` | `language`, `contentHash` | |
| `Class` | `abstract`, `doc` | |
| `Function` | `signature`, `async`, `generator`, `arrow`, `exported`, `doc` | includes arrow fns bound to names |
| `Method` | `signature`, `static`, `visibility`, `doc` | |
| `Hook` | `signature`, `builtin`, `doc` | `use*` functions |
| `Component` | `componentKind` (fn/class/memo/forwardRef), `propsType`, `doc` | React |
| `Interface` | `doc` | TS |
| `Enum` | `const`, `doc` | TS |
| `TypeAlias` | `doc` | TS |
| `Variable` | `varKind` (const/let/var), `typeText` | module-level |
| `Import` | `source`, `specifiers`, `importKind` | one per import statement |
| `Export` | `exportKind` (named/default/re-export), `source?` | |
| `Route` | `routePattern`, `method?`, `framework` | **never deleted implicitly** |
| `Api` | `method`, `urlPattern` | API handlers / fetch call sites |
| `Context` | `defaultValueText?` | React context objects |
| `Dependency` | `version`, `depKind` (prod/dev/peer) | external packages |
| `Test` | `framework`, `titlePath` | test cases/suites |
| `Configuration` | `configKind` (tsconfig/vite/next/eslint/…) | parsed config files |

## 2. Edge types

| Edge | From → To | Meaning |
| --- | --- | --- |
| `CONTAINS` | Repository→Package→Directory→File→symbol | physical hierarchy |
| `IMPORTS` | File → File \| Dependency | module dependency (props: `specifiers`) |
| `EXPORTS` | File → symbol | exported surface (props: `exportKind`, `alias`) |
| `CALLS` | Function/Method/Hook/Component → Function/Method/Hook | call sites (props: `line`, `count`) |
| `USES` | symbol → Variable/Enum/TypeAlias | identifier usage |
| `DEFINES` | File → symbol; Class → Method | definition ownership |
| `DECLARES` | File → Variable/Import/Export | declarations |
| `IMPLEMENTS` | Class → Interface | |
| `EXTENDS` | Class → Class; Interface → Interface | |
| `RETURNS` | Function/Method → TypeAlias/Interface/Class | declared return type |
| `READS` / `WRITES` | Function/Method → Variable | state access |
| `DEPENDS_ON` | Package → Dependency; File → Configuration | |
| `TESTS` | Test → symbol/File | coverage links |
| `REFERENCES` | any symbol → any symbol | fallback typed reference |
| `USES_COMPONENT` | Component → Component | JSX usage (props: `count`) |
| `USES_HOOK` | Component/Hook → Hook | hook call |
| `PROVIDES_CONTEXT` | Component → Context | renders `<X.Provider>` |
| `CONSUMES_CONTEXT` | Component/Hook → Context | `useContext(X)` / consumer |
| `HANDLES` | Function/Component → Route/Api | route handler binding |

## 3. Update semantics

- All writes are `MERGE`-based and idempotent; keyed by `id`.
- Reindexing file F: `MATCH (f:File {id})-[:DEFINES|DECLARES]->(s) DETACH DELETE s` then re-create — **except** `Route` nodes, which are matched by `routePattern` and updated (history preserved, `HANDLES` re-pointed).
- Cross-file edges are written in a resolution pass after all touched files are parsed; dangling references get `REFERENCES {unresolved: true}` so they heal when the target is indexed.
- Full graph rebuild only via explicit `--rebuild`.

## 4. Canonical queries

```cypher
// Who calls fetchUser()?
MATCH (caller)-[:CALLS]->(f:Function {name: 'fetchUser', repoId: $repo})
RETURN caller.id, caller.path, caller.name;

// Call hierarchy (downstream, 3 hops)
MATCH p = (f {id: $id})-[:CALLS*1..3]->(callee)
RETURN p;

// Unused React components (no JSX usage, not an entry point)
MATCH (c:Component {repoId: $repo})
WHERE NOT ()-[:USES_COMPONENT]->(c) AND NOT (c)-[:HANDLES]->(:Route)
RETURN c.id, c.path;

// Which files depend on axios?
MATCH (fl:File {repoId: $repo})-[:IMPORTS]->(d:Dependency {name: 'axios'})
RETURN fl.path;

// Context flow
MATCH (p:Component)-[:PROVIDES_CONTEXT]->(ctx:Context)<-[:CONSUMES_CONTEXT]-(c)
RETURN p.name, ctx.name, collect(c.name);
```
