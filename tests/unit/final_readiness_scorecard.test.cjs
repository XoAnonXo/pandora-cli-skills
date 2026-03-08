'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCapabilitiesPayloadAsync } = require('../../cli/lib/capabilities_command_service.cjs');

test('A+ scorecard reports honest blockers without misclassifying release drift discipline', async () => {
  const payload = await buildCapabilitiesPayloadAsync({
    artifactNeutralProfileReadiness: true,
  });
  const certification = payload && payload.certification ? payload.certification.aPlus : null;

  assert.ok(certification, 'capabilities payload should expose certification.aPlus');
  assert.equal(certification.targetTier, 'A+');
  assert.equal(certification.status, 'not-certified');
  assert.equal(certification.blockingCheckIds.includes('release-drift-discipline'), false);
  assert.equal(certification.blockingCheckIds.includes('typescript-sdk-publication'), false);
  assert.equal(certification.blockingCheckIds.includes('python-sdk-publication'), true);
  assert.equal(certification.blockingCheckIds.includes('runtime-ready-mutable-profiles'), true);
});
