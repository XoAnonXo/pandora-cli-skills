#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');
const BUNDLE_NAME = 'pandora-skill';
const BUNDLE_ROOT = path.join(DIST_ROOT, BUNDLE_NAME);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function listFilesRecursively(startDir) {
  const output = [];
  for (const entry of fs.readdirSync(startDir, { withFileTypes: true })) {
    const fullPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      output.push(...listFilesRecursively(fullPath));
    } else {
      output.push(fullPath);
    }
  }
  return output;
}

function relativePath(value) {
  return path.relative(REPO_ROOT, value).split(path.sep).join('/');
}

function parseFrontmatter(text) {
  const match = String(text).match(/^---\n([\s\S]*?)\n---\n?/);
  assert(match, 'bundle SKILL.md is missing YAML frontmatter');
  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : '',
    description: descriptionMatch ? descriptionMatch[1].trim() : '',
  };
}

function validateLinks(filePath, bundleFiles) {
  const text = read(filePath);
  const linkMatches = text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
  for (const match of linkMatches) {
    const rawTarget = String(match[1] || '').trim();
    if (!rawTarget || rawTarget.startsWith('#') || /^[a-z]+:/i.test(rawTarget)) {
      continue;
    }
    const cleanTarget = rawTarget.split('#')[0];
    if (!cleanTarget) {
      continue;
    }
    const resolved = path.resolve(path.dirname(filePath), cleanTarget);
    assert(
      resolved.startsWith(BUNDLE_ROOT + path.sep) || resolved === BUNDLE_ROOT,
      `link in ${relativePath(filePath)} resolves outside bundle: ${rawTarget}`,
    );
    assert(bundleFiles.has(resolved), `broken bundle link in ${relativePath(filePath)}: ${rawTarget}`);
  }
}

function maybeBuildBundle() {
  const wantsBuild = process.argv.includes('--build');
  if (!wantsBuild) {
    return;
  }
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'build_anthropic_skill_bundle.cjs')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    const message = result.error ? result.error.message : result.stderr || result.stdout || 'bundle build failed';
    throw new Error(message.trim());
  }
}

function main() {
  maybeBuildBundle();

  assert(fs.existsSync(BUNDLE_ROOT), `bundle directory missing: ${relativePath(BUNDLE_ROOT)}`);
  assert(fs.statSync(BUNDLE_ROOT).isDirectory(), 'bundle root is not a directory');

  const skillPath = path.join(BUNDLE_ROOT, 'SKILL.md');
  const referencesDir = path.join(BUNDLE_ROOT, 'references');
  assert(fs.existsSync(skillPath), 'bundle SKILL.md is missing');
  assert(fs.existsSync(referencesDir), 'bundle references directory is missing');
  assert(fs.statSync(referencesDir).isDirectory(), 'bundle references path is not a directory');

  const forbiddenPaths = [
    path.join(BUNDLE_ROOT, 'README.md'),
    path.join(BUNDLE_ROOT, 'README_FOR_SHARING.md'),
    path.join(BUNDLE_ROOT, 'package.json'),
    path.join(BUNDLE_ROOT, 'node_modules'),
  ];
  for (const forbiddenPath of forbiddenPaths) {
    assert(!fs.existsSync(forbiddenPath), `forbidden bundle file present: ${relativePath(forbiddenPath)}`);
  }

  const skillText = read(skillPath);
  const frontmatter = parseFrontmatter(skillText);
  assert(frontmatter.name === BUNDLE_NAME, `bundle name ${frontmatter.name || '<missing>'} must match folder ${BUNDLE_NAME}`);
  assert(frontmatter.description, 'bundle SKILL.md is missing description frontmatter');
  assert(/use when/i.test(frontmatter.description), 'bundle description must include "Use when" trigger guidance');

  const markdownFiles = listFilesRecursively(BUNDLE_ROOT).filter((filePath) => filePath.endsWith('.md'));
  const bundleFiles = new Set(listFilesRecursively(BUNDLE_ROOT));
  assert(markdownFiles.length >= 2, 'bundle should contain SKILL.md plus bundled references');
  assert(!markdownFiles.some((filePath) => path.basename(filePath) === 'README.md'), 'bundle must not contain README.md');

  for (const markdownFile of markdownFiles) {
    validateLinks(markdownFile, bundleFiles);
  }

  const summary = {
    ok: true,
    bundleRoot: relativePath(BUNDLE_ROOT),
    markdownFiles: markdownFiles.map(relativePath),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`check_anthropic_skill_bundle failed: ${error.message}\n`);
  process.exit(1);
}
