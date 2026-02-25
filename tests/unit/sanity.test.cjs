const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const pkg = require(path.resolve(__dirname, '..', '..', 'package.json'));

test('package exposes pandora bin entrypoint', () => {
  assert.equal(pkg.name, 'pandora-market-setup');
  assert.equal(pkg.bin.pandora, 'cli/pandora.cjs');
  assert.ok(pkg.scripts['test:smoke']);
  assert.ok(pkg.files.includes('cli/pandora.cjs'));
  assert.ok(pkg.files.includes('scripts/create_market_launcher.ts'));
  assert.ok(pkg.files.includes('scripts/create_polymarket_clone_and_bet.ts'));
});
