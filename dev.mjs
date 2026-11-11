// 本機預覽：node dev.mjs → http://localhost:3044（跟 GitHub Pages 一樣只是靜態檔）
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 3044);
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css" };
http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const full = normalize(join(ROOT, p));
  if (!full.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  try { const b = await readFile(full); res.setHeader("Content-Type", TYPES[extname(full)] || "application/octet-stream"); res.end(b); }
  catch { res.statusCode = 404; res.end("not found"); }
}).listen(PORT, "127.0.0.1", () => console.log(`realtor-news → http://localhost:${PORT}`));
