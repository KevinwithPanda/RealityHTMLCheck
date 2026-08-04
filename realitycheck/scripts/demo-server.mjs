import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEMO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "demo");
const ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/avatar.svg", ["avatar.svg", "image/svg+xml"]],
  ["/api/orders.json", ["api/orders.json", "application/json; charset=utf-8"]],
]);

function responseHeaders(contentType) {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
    "content-type": contentType,
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
  };
}

export function createDemoRequestHandler() {
  return (request, response) => {
    if (!new Set(["GET", "HEAD"]).has(request.method || "")) {
      response.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
      response.end();
      return;
    }
    let pathname;
    try {
      pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    } catch (_) {
      response.writeHead(400, { "cache-control": "no-store" });
      response.end();
      return;
    }
    const asset = ASSETS.get(pathname);
    if (!asset) {
      response.writeHead(404, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : "Not found");
      return;
    }
    try {
      const body = readFileSync(join(DEMO_ROOT, asset[0]));
      response.writeHead(200, { ...responseHeaders(asset[1]), "content-length": body.length });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (_) {
      response.writeHead(500, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : "Bundled demo asset unavailable");
    }
  };
}

export async function startBundledDemoServer() {
  const server = createServer(createDemoRequestHandler());
  server.on("clientError", (error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a loopback port for the bundled demo");
  }
  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}/`,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
