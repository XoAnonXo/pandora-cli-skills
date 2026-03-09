#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const { buildCommandDescriptors } = require(path.join(rootDir, 'cli/lib/agent_contract_registry.cjs'));
const { buildSkillDocIndex } = require(path.join(rootDir, 'cli/lib/skill_doc_registry.cjs'));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function main() {
  const descriptors = buildCommandDescriptors();
  const docIndex = buildSkillDocIndex();
  const routerText = readText('SKILL.md');
  const readmeText = readText('README.md');
  const shareableText = readText('README_FOR_SHARING.md');

  assert(docIndex && Array.isArray(docIndex.skills), 'skill doc index is missing skills');
  assert(docIndex.router && docIndex.router.path === 'SKILL.md', 'skill doc router path must point to SKILL.md');
  assert(typeof docIndex.contentHash === 'string' && docIndex.contentHash.trim(), 'skill doc index is missing contentHash');
  assert(Array.isArray(docIndex.sourceFiles) && docIndex.sourceFiles.includes('SKILL.md'), 'skill doc index is missing sourceFiles');
  assert(Array.isArray(docIndex.router.startHere) && docIndex.router.startHere.length > 0, 'skill doc router is missing startHere routes');
  assert(Array.isArray(docIndex.router.taskRoutes) && docIndex.router.taskRoutes.length > 0, 'skill doc router is missing task routes');

  for (const doc of docIndex.skills) {
    assert(typeof doc.path === 'string' && doc.path.trim(), `skill doc ${doc.id} is missing a path`);
    assert(fs.existsSync(path.join(rootDir, doc.path)), `skill doc file does not exist: ${doc.path}`);
    assert(typeof doc.summary === 'string' && doc.summary.trim(), `skill doc ${doc.id} is missing summary text`);
    assert(typeof doc.contentHash === 'string' && doc.contentHash.trim(), `skill doc ${doc.id} is missing contentHash`);

    for (const toolName of doc.canonicalTools || []) {
      assert(descriptors[toolName], `skill doc ${doc.id} references unknown canonical tool: ${toolName}`);
    }

    if (doc.featured) {
      assert(routerText.includes(doc.path), `SKILL.md is missing featured doc route: ${doc.path}`);
      assert(readmeText.includes(doc.path), `README.md is missing featured doc route: ${doc.path}`);
      assert(shareableText.includes(doc.path), `README_FOR_SHARING.md is missing featured doc route: ${doc.path}`);
    }
  }

  const knownDocIds = new Set(docIndex.skills.map((doc) => doc.id));
  const routedDocIds = new Set();
  for (const route of docIndex.router.startHere.concat(docIndex.router.taskRoutes)) {
    assert(knownDocIds.has(route.docId), `skill doc router references unknown doc id: ${route.docId}`);
    assert(typeof route.label === 'string' && route.label.trim(), `skill doc route ${route.docId} is missing a label`);
    assert(typeof route.path === 'string' && route.path.trim(), `skill doc route ${route.docId} is missing a path`);
    routedDocIds.add(route.docId);
  }
  for (const docId of knownDocIds) {
    assert(routedDocIds.has(docId), `skill doc ${docId} is missing from the router`);
  }
}

try {
  main();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(`check:docs failed: ${error.message}`);
  process.exit(1);
}
