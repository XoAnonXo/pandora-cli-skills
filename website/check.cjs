"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = __dirname;

const build = spawnSync("npm", ["run", "build"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const distIndex = path.join(root, "dist", "index.html");
if (!fs.existsSync(distIndex)) {
  console.error("website check failed: dist/index.html was not created");
  process.exit(1);
}

const filesToScan = [distIndex];
const assetsDir = path.join(root, "dist", "assets");
if (fs.existsSync(assetsDir)) {
  for (const entry of fs.readdirSync(assetsDir)) {
    if (entry.endsWith(".js") || entry.endsWith(".css")) {
      filesToScan.push(path.join(assetsDir, entry));
    }
  }
}

const builtOutput = filesToScan
  .map((filePath) => fs.readFileSync(filePath, "utf8"))
  .join("\n");

for (const expected of [
  "Pandora for agents, builders, and operators.",
  "Three clear paths.",
  "One workflow, three interfaces.",
  "The homepage proof set.",
]) {
  if (!builtOutput.includes(expected)) {
    console.error(`website check failed: missing "${expected}" in built output`);
    process.exit(1);
  }
}

console.log("website check passed");
