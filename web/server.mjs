import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const portText = process.env.PORT ?? "4173";
if (!/^\d+$/.test(portText)) throw new Error("PORT must be a positive integer");
const port = Number.parseInt(portText, 10);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/") { response.writeHead(302, { Location: "/v2/" }); response.end(); return; }
    if (pathname.startsWith("/v2/api/")) {
      response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ detail: "静态预览没有认证服务，请使用本地合成 API 检查或联系管理员。" })); return;
    }
    if (!pathname.startsWith("/v2/")) throw new Error("Unsupported preview path");
    const asset = pathname.slice(4) || "index.html";
    if (!["index.html", "styles.css", "sw.js", "manifest.webmanifest"].includes(asset)
      && !/^js\/[A-Za-z0-9_-]+\.js$/.test(asset)
      && !/^(assets|icons)\/[A-Za-z0-9_.-]+\.(png|jpg|svg)$/.test(asset)) throw new Error("Unsupported preview file");
    const target = resolve(root, asset);
    if (!target.startsWith(resolve(root) + sep)) throw new Error("Path outside web root");
    if (!statSync(target).isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(target).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`机采棉静态预览（无认证服务）：http://127.0.0.1:${port}/v2/`);
});
