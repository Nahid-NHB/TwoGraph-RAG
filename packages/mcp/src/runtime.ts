import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  WebStandardStreamableHTTPServerTransport,
  type WebStandardStreamableHTTPServerTransportOptions,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildMcpServer } from './server.js';

// Bare-optional in the SDK's own option type (`sessionIdGenerator?: () =>
// string`) vs. the explicit `undefined` stateless mode requires — an upstream
// typing gap that only surfaces under this repo's `exactOptionalPropertyTypes`.
const STATELESS_OPTIONS = {
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
} as unknown as WebStandardStreamableHTTPServerTransportOptions;

export const DEFAULT_HTTP_PORT = 4802;
export const MCP_PATH = '/mcp';

/** Connects a fresh MCP server over stdio — the default transport, used by MCP clients that spawn a child process. */
export async function startStdioServer(): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function toWebRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), {
    method: req.method ?? 'GET',
    headers,
    ...(hasBody ? { body: Readable.toWeb(req) as unknown as ReadableStream, duplex: 'half' } : {}),
  });
}

async function writeWebResponse(webResponse: Response, res: ServerResponse): Promise<void> {
  res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
  if (!webResponse.body) {
    res.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(webResponse.body as never)
      .on('error', reject)
      .pipe(res)
      .on('finish', resolve)
      .on('error', reject);
  });
}

/**
 * Connects a fresh MCP server over streamable HTTP, stateless (no session
 * tracking — every request is independent). Listens at `http://host:port/mcp`.
 *
 * A stateless transport is single-use — reusing one across requests throws
 * "Stateless transport cannot be reused across requests" — so each incoming
 * HTTP request gets its own ephemeral `McpServer` + transport pair, per the
 * SDK's own stateless-deployment model ("any server node can process
 * requests"). Talks to the transport via its pure Web Standard
 * `handleRequest(Request): Promise<Response>` overload, converting Node's
 * `IncomingMessage`/`ServerResponse` by hand rather than going through
 * `@hono/node-server` (which 500s in this environment once a process has
 * already handled one request, reproducible with plain `fetch`, no MCP
 * client involved).
 */
export async function startHttpServer(port = DEFAULT_HTTP_PORT): Promise<void> {
  const httpServer = createServer((req, res) => {
    if (req.url !== MCP_PATH) {
      res.writeHead(404).end('not found');
      return;
    }
    void (async () => {
      const server = buildMcpServer();
      const transport = new WebStandardStreamableHTTPServerTransport(STATELESS_OPTIONS);
      try {
        await server.connect(transport);
        const webResponse = await transport.handleRequest(toWebRequest(req));
        await writeWebResponse(webResponse, res);
      } catch (err) {
        res
          .writeHead(500, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: err instanceof Error ? err.message : 'internal error' }));
      } finally {
        await transport.close();
      }
    })();
  });

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  process.stderr.write(`twograph-mcp listening on http://localhost:${String(port)}${MCP_PATH}\n`);
}
