#!/usr/bin/env node

process.stderr.write([
  'Direct source-tree npm publish is intentionally blocked.',
  'Run `npm run release:publish` to verify once, pack once, and publish the prebuilt tarball.',
  'If you need to split the steps, run `npm run release:prep`, `npm run release:pack`, then `npm run release:publish:artifact`.',
].join('\n'));
process.stderr.write('\n');
process.exit(1);
