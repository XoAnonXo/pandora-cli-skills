const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aggregateCouncilDecision,
  buildReviewPacket,
  parseReviewerDecision,
} = require('../../proving-ground/lib/baton_council.cjs');

test('council accepts when quorum is met without veto roles blocking', () => {
  const decision = aggregateCouncilDecision([
    { role: 'correctness', verdict: 'accept', lowSignal: false, blockers: [], evidence: [] },
    { role: 'determinism', verdict: 'accept', lowSignal: false, blockers: [], evidence: [] },
    { role: 'safety', verdict: 'accept', lowSignal: false, blockers: [], evidence: [] },
    { role: 'performance', verdict: 'accept', lowSignal: false, blockers: [], evidence: [] },
    { role: 'simplicity', verdict: 'revise', lowSignal: false, blockers: [], evidence: [] },
    { role: 'goal-fit', verdict: 'accept', lowSignal: false, blockers: [], evidence: [] },
  ], { quorum: 4 });
  assert.equal(decision.outcome, 'accept');
  assert.equal(decision.acceptCount, 5);
});

test('council rejects when a veto role blocks the proposal', () => {
  const decision = aggregateCouncilDecision([
    { role: 'correctness', verdict: 'accept', lowSignal: false, blockers: [], evidence: [] },
    { role: 'determinism', verdict: 'accept', lowSignal: false, blockers: [], evidence: [] },
    { role: 'safety', verdict: 'reject', lowSignal: false, blockers: ['unsafe'], evidence: [] },
    { role: 'performance', verdict: 'accept', lowSignal: false, blockers: [], evidence: [] },
    { role: 'simplicity', verdict: 'accept', lowSignal: false, blockers: [], evidence: [] },
    { role: 'goal-fit', verdict: 'accept', lowSignal: false, blockers: [], evidence: [] },
  ], { quorum: 4 });
  assert.equal(decision.outcome, 'reject');
  assert.equal(decision.vetoCount, 1);
});

test('review packet fingerprints proposal and lane context deterministically', () => {
  const packetA = buildReviewPacket({
    laneId: 'lane-01',
    attemptIndex: 1,
    proposal: {
      summary: 'Trim help copy',
      why: 'Faster operator scan',
      targetFiles: ['cli/lib/help.cjs'],
      changeSet: [],
    },
    baseline: { overallPass: true, totalElapsedMs: 10 },
    section: {
      id: 'alpha',
      title: 'Alpha',
      description: 'desc',
      commandPrefixes: ['alpha'],
      focusFiles: ['cli/lib/help.cjs'],
    },
    promptVersion: 'baton-v1',
  });
  const packetB = buildReviewPacket({
    laneId: 'lane-01',
    attemptIndex: 1,
    proposal: {
      summary: 'Trim help copy',
      why: 'Faster operator scan',
      targetFiles: ['cli/lib/help.cjs'],
      changeSet: [],
    },
    baseline: { overallPass: true, totalElapsedMs: 10 },
    section: {
      id: 'alpha',
      title: 'Alpha',
      description: 'desc',
      commandPrefixes: ['alpha'],
      focusFiles: ['cli/lib/help.cjs'],
    },
    promptVersion: 'baton-v1',
  });
  assert.equal(packetA.fingerprint, packetB.fingerprint);
});

test('parseReviewerDecision skips stray code before the real JSON object', () => {
  const review = parseReviewerDecision(`const { noisy } = helper;
{
  "reviewerId": "correctness-reviewer",
  "role": "correctness",
  "verdict": "accept",
  "confidence": 0.91,
  "blockers": [],
  "evidence": ["proposal is lane-scoped"],
  "lowSignal": false,
  "duplicateOf": null
}`, 'correctness');
  assert.equal(review.verdict, 'accept');
  assert.equal(review.evidence[0], 'proposal is lane-scoped');
});
