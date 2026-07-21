// Dumps the server's OpenAPI document to disk so `openapi-typescript` can turn
// it into `src/api/schema.d.ts` — the typed API client is generated, never
// hand-written (issue #56 acceptance criterion).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildServer } from '@twograph/server';

const app = await buildServer();
await app.ready();
const spec = app.swagger();
const outPath = fileURLToPath(new URL('../openapi.json', import.meta.url));
writeFileSync(outPath, JSON.stringify(spec, null, 2));
await app.close();
console.log(`Wrote ${outPath}`);
