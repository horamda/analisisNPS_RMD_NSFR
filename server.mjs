import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aiHeaders, callAi, loadLocalEnv, readRequestBody } from "./ai-proxy.mjs";

loadLocalEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");
const indexFile = path.join(distDir, "index.html");
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || "0.0.0.0";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function resolvePublicPath(requestUrl) {
  const url = new URL(requestUrl, `http://${host}:${port}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const targetPath = path.join(distDir, decodedPath);
  const relative = path.relative(distDir, targetPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return targetPath;
}

async function getFilePath(requestUrl) {
  const publicPath = resolvePublicPath(requestUrl);
  if (!publicPath) return null;

  try {
    const info = await stat(publicPath);
    if (info.isDirectory()) return path.join(publicPath, "index.html");
    if (info.isFile()) return publicPath;
  } catch {
    return indexFile;
  }

  return indexFile;
}

const server = createServer(async (req, res) => {
  const pathname = (req.url || "").split("?")[0];
  if (pathname === "/api/ai" && req.method === "OPTIONS") {
    res.writeHead(204, aiHeaders);
    res.end();
    return;
  }

  if (pathname === "/api/ai" && req.method === "POST") {
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || "{}");
      const data = await callAi(payload);
      res.writeHead(200, aiHeaders);
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(502, aiHeaders);
      res.end(JSON.stringify({ error: { message: error.message || "IA no disponible" } }));
    }
    return;
  }

  if (pathname === "/api/ai") {
    res.writeHead(405, { ...aiHeaders, Allow: "POST, OPTIONS" });
    res.end(JSON.stringify({ error: { message: "Metodo no permitido" } }));
    return;
  }

  if (!["GET", "HEAD"].includes(req.method || "")) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method Not Allowed");
    return;
  }

  const filePath = await getFilePath(req.url || "/");
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const extension = path.extname(filePath).toLowerCase();
    const isAsset = filePath.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(500);
    res.end("Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`Dashboard listening on http://${host}:${port}`);
});
