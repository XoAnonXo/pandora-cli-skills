"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const port = Number(process.env.PORT || 4183);
const root = path.join(__dirname, "dist");

if (!fs.existsSync(path.join(root, "index.html"))) {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: __dirname,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function resolveRequestPath(urlPath) {
  const normalizedPath = decodeURIComponent(urlPath.split("?")[0]);
  const relativePath = normalizedPath === "/" ? "/index.html" : normalizedPath;
  const absolutePath = path.normalize(path.join(root, relativePath));

  if (!absolutePath.startsWith(root)) {
    return null;
  }

  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
    return absolutePath;
  }

  return path.join(root, "index.html");
}

const server = http.createServer((request, response) => {
  const targetPath = resolveRequestPath(request.url || "/");
  if (!targetPath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  const extension = path.extname(targetPath).toLowerCase();
  const contentType = mimeTypes[extension] || "application/octet-stream";

  try {
    const body = fs.readFileSync(targetPath);
    response.writeHead(200, { "Content-Type": contentType });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Pandora site available at http://127.0.0.1:${port}`);
});
