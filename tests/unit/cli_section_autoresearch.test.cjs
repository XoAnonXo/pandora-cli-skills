const test = require('node:test');
const assert = require('node:assert/strict');

const commandDescriptors = require('../../sdk/generated/command-descriptors.json');
const {
  buildDecisionSummary,
  buildSectionCoverage,
  loadCliSectionResearchConfig,
  matchesCommandPrefix,
  parseSectionProposal,
} = require('../../proving-ground/lib/cli_section_autoresearch.cjs');

test('CLI section research config loads the expected section registry', () => {
  const config = loadCliSectionResearchConfig({
    cwd: process.cwd(),
  });
  assert.equal(config.sections.length, 10);
  assert.equal(config.researchLoop.iterationsPerSection, 50);
  assert.equal(config.model.provider, 'minimax');
});

test('CLI section coverage assigns every command descriptor to a section', () => {
  const config = loadCliSectionResearchConfig({
    cwd: process.cwd(),
  });
  const coverage = buildSectionCoverage(commandDescriptors, config.sections);
  assert.equal(coverage.uncoveredCommands.length, 0);
  assert.equal(coverage.coveredCommands, coverage.totalCommands);
  assert.equal(coverage.perSection['polymarket-hedge-mode'].commandNames.includes('mirror.hedge.start'), true);
  assert.equal(coverage.perSection['pandora-mirroring-mode'].commandNames.includes('mirror.sync.run'), true);
  assert.equal(coverage.perSection['mirror-deploy-lifecycle'].commandNames.includes('mirror.deploy'), true);
});

test('matchesCommandPrefix prefers exact names and dotted children only', () => {
  assert.equal(matchesCommandPrefix('mirror.sync.run', 'mirror.sync'), true);
  assert.equal(matchesCommandPrefix('mirror.hedge.start', 'mirror.sync'), false);
  assert.equal(matchesCommandPrefix('trade', 'trade'), true);
  assert.equal(matchesCommandPrefix('trader', 'trade'), false);
});

test('parseSectionProposal extracts clarity, speed, and simplicity expectations', () => {
  const proposal = parseSectionProposal(`{
    "hypothesisId": "trim-help",
    "summary": "Tighten mirror help copy",
    "why": "Operators should see the mode split sooner.",
    "targetFiles": ["cli/lib/mirror_command_service.cjs"],
    "expectedImpact": {
      "clarity": "Cleaner mode naming",
      "speed": "No runtime change",
      "simplicity": "Less branching in help text"
    },
    "validationNotes": ["Run mirror help tests"],
    "changeSet": []
  }`);
  assert.equal(proposal.hypothesisId, 'trim-help');
  assert.equal(proposal.expectedImpact.clarity, 'Cleaner mode naming');
  assert.equal(proposal.expectedImpact.simplicity, 'Less branching in help text');
});

test('buildDecisionSummary keeps simpler changes even when speed is flat', () => {
  const section = {
    allowNeutralKeep: false,
  };
  const decision = buildDecisionSummary({
    baselineGate: {
      totalElapsedMs: 100,
      failedCount: 0,
      passRate: 1,
    },
    candidateGate: {
      totalElapsedMs: 100,
      failedCount: 0,
      passRate: 1,
    },
    appliedChangeSet: {
      summary: {
        touchedFiles: 1,
        addedLines: 2,
        removedLines: 8,
        netLineDelta: -6,
      },
    },
    section,
    maxSlowdownRatio: 1.02,
  });
  assert.equal(decision.keep, true);
  assert.equal(decision.simplificationSignal, true);
});

test('buildDecisionSummary rejects slower neutral edits without a clear simplification signal', () => {
  const section = {
    allowNeutralKeep: false,
  };
  const decision = buildDecisionSummary({
    baselineGate: {
      totalElapsedMs: 100,
      failedCount: 0,
      passRate: 1,
    },
    candidateGate: {
      totalElapsedMs: 104,
      failedCount: 0,
      passRate: 1,
    },
    appliedChangeSet: {
      summary: {
        touchedFiles: 2,
        addedLines: 12,
        removedLines: 0,
        netLineDelta: 12,
      },
    },
    section,
    maxSlowdownRatio: 1.02,
  });
  assert.equal(decision.keep, false);
  assert.equal(decision.acceptableSpeed, false);
});
