import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] || 4193);
if (!Number.isInteger(port) || port < 1024 || port > 65534) throw new Error("port must be an integer from 1024 to 65534");
const assetPort = port + 1;

const asset = "window.__realityCheckReviewedAsset = true;\n";
const assetIntegrity = `sha384-${createHash("sha384").update(asset).digest("base64")}`;
const html = (withIntegrity) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Semantic security header laboratory</title><script src="http://127.0.0.1:${assetPort}/asset.js"${withIntegrity ? ` integrity="${assetIntegrity}" crossorigin="anonymous"` : ""}></script></head><body><main><h1>Semantic response-header laboratory</h1><p>This stable page isolates response-policy and cross-origin executable-resource integrity behavior without forms or browser storage.</p><button type="button">Review header<br>evidence</button></main></body></html>`;

const variants = {
  "/broken": {
    withIntegrity: false,
    "content-security-policy": `default-src 'self'; script-src 'self' 'unsafe-eval' http://127.0.0.1:${assetPort}`,
    "x-content-type-options": "sniff",
    "referrer-policy": "unsafe-url",
    "permissions-policy": "camera=(self \"https://private.example\"), microphone=()",
  },
  "/fixed": {
    withIntegrity: true,
    "content-security-policy": `default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self' http://127.0.0.1:${assetPort}`,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  },
};

const server = createServer((request, response) => {
  if (!new Set(["GET", "HEAD"]).has(request.method || "")) {
    response.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
    response.end();
    return;
  }
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  const headers = variants[pathname];
  if (!headers) {
    response.writeHead(404, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : "Not found");
    return;
  }
  const body = html(headers.withIntegrity);
  const { withIntegrity: _withIntegrity, ...responseHeaders } = headers;
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...responseHeaders,
  });
  response.end(request.method === "HEAD" ? undefined : body);
});

server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
const assetServer = createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  if (!new Set(["GET", "HEAD"]).has(request.method || "")) {
    response.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
    response.end();
    return;
  }
  if (pathname !== "/asset.js") {
    response.writeHead(404, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : "Not found");
    return;
  }
  response.writeHead(200, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "text/javascript; charset=utf-8",
    "content-length": Buffer.byteLength(asset),
  });
  response.end(request.method === "HEAD" ? undefined : asset);
});
assetServer.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
assetServer.listen(assetPort, "127.0.0.1", () => {
  server.listen(port, "127.0.0.1", () => console.log(`Security header lab: http://127.0.0.1:${port}/broken and /fixed; reviewed asset on ${assetPort}`));
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  let remaining = 2;
  const closed = () => { if ((remaining -= 1) === 0) process.exit(0); };
  server.close(closed);
  assetServer.close(closed);
});
