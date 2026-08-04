import { createServer } from "node:http";

const port = Number(process.argv[2] || 4193);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("port must be an integer from 1024 to 65535");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Semantic security header laboratory</title></head><body><main><h1>Semantic response-header laboratory</h1><p>This stable page isolates response policy behavior without forms, scripts, storage, or third-party resources.</p><button type="button">Review header<br>evidence</button></main></body></html>`;

const common = {
  "cache-control": "no-store",
  "content-type": "text/html; charset=utf-8",
  "content-length": Buffer.byteLength(html),
};
const variants = {
  "/broken": {
    "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-eval'",
    "x-content-type-options": "sniff",
    "referrer-policy": "unsafe-url",
    "permissions-policy": "camera=(self \"https://private.example\"), microphone=()",
  },
  "/fixed": {
    "content-security-policy": "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self'",
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
  response.writeHead(200, { ...common, ...headers });
  response.end(request.method === "HEAD" ? undefined : html);
});

server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
server.listen(port, "127.0.0.1", () => console.log(`Security header lab: http://127.0.0.1:${port}/broken and /fixed`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
