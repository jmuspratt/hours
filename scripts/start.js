#!/usr/bin/env node
// Serves app/ as static files for local development, and proxies /api/*
// to scripts/api-server.js so dev mirrors prod's same-origin nginx setup
// (no CORS needed either way).
// Usage: node scripts/start.js  (defaults to port 3000, or PORT env var)

import { createServer } from "http";
import { readFile } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "app");
const PORT = process.env.PORT || 3000;
const API_PORT = process.env.API_PORT || 8787;

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    try {
      const apiRes = await fetch(`http://localhost:${API_PORT}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
        duplex: "half",
      });
      res.writeHead(apiRes.status, Object.fromEntries(apiRes.headers));
      res.end(Buffer.from(await apiRes.arrayBuffer()));
    } catch {
      res.writeHead(502);
      res.end("Edit-mode API proxy unreachable (is `npm run api` running?)");
    }
    return;
  }

  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = join(ROOT, urlPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    const type = MIME_TYPES[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Serving app/ at http://localhost:${PORT}`);
});
