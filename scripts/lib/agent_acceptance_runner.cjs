'use strict';

const pkg = require('../../package.json');
const functionalScenarios = require('../../tests/skills/functional-scenarios.json');
const triggerFixtures = require('../../tests/skills/trigger-fixtures.json');
const { buildActionInventory, runSurfaceE2e } = require('./surface_e2e_runner.cjs');
const { SUPPORTED_SCENARIOS, runUserJourneys } = require('./user_journey_runner.cjs');

const REPORT_SCHEMA_VERSION = '1.0.0';
const REPORT_KIND = 'agent-acceptance-report';
const DEFAULT_SURFACES = Object.freeze(['cli-json', 'mcp-stdio', 'mcp-http', 'skill-bundle', 'skill-runtime']);
const DEFAULT_JOURNEYS = 'all';
const DEFAULT_MODE = 'fast';
const ACCEPTANCE_MODES = Object.freeze(['fast', 'full']);
const FAST_SKILL_SCENARIO_IDS = Object.freeze([
  'safe-bootstrap',
  'market-suggestions',
  'watch-risk-monitoring',
]);

function compareStableStrings(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function buildFamilySummary(actions) {
  const map = new Map();
  for (const action of Array.isArray(actions) ? actions : []) {
    const family = String(action && action.name ? action.name : '').split('.')[0] || 'unknown';
    const current = map.get(family) || {
      family,
      total: 0,
      mcpExposed: 0,
      cliOnly: 0,
      requiresSecrets: 0,
      readLike: 0,
      mutatingLike: 0,
    };
    current.total += 1;
    if (action && action.mcpExposed === true) {
      current.mcpExposed += 1;
    } else {
      current.cliOnly += 1;
    }
    if (action && action.requiresSecrets === true) current.requiresSecrets += 1;
    if (action && (action.actionClass === 'read' || action.actionClass === 'non-mcp')) {
      current.readLike += 1;
    } else {
      current.mutatingLike += 1;
    }
    map.set(family, current);
  }
  return Array.from(map.values()).sort((left, right) => {
    const countDelta = Number(right.total || 0) - Number(left.total || 0);
    if (countDelta !== 0) return countDelta;
    return compareStableStrings(left.family, right.family);
  });
}

function buildSkillScenarioCatalog() {
  const triggerShould = Array.isArray(triggerFixtures.shouldTrigger) ? triggerFixtures.shouldTrigger : [];
  const triggerParaphrase = Array.isArray(triggerFixtures.paraphraseShouldTrigger) ? triggerFixtures.paraphraseShouldTrigger : [];
  const shouldNotTrigger = Array.isArray(triggerFixtures.shouldNotTrigger) ? triggerFixtures.shouldNotTrigger : [];
  const functional = Array.isArray(functionalScenarios.scenarios) ? functionalScenarios.scenarios : [];
  return {
    triggerShouldCount: triggerShould.length,
    triggerParaphraseCount: triggerParaphrase.length,
    shouldNotTriggerCount: shouldNotTrigger.length,
    functionalCount: functional.length,
    totalCount: triggerShould.length + triggerParaphrase.length + shouldNotTrigger.length + functional.length,
    functionalScenarioIds: functional.map((scenario) => scenario.id).sort(compareStableStrings),
  };
}

function buildInventorySummary(inventory) {
  const actions = Array.isArray(inventory && inventory.actions) ? inventory.actions : [];
  return {
    actionCount: Number(inventory && inventory.actionCount) || actions.length,
    mcpActionCount: Number(inventory && inventory.mcpActionCount) || actions.filter((action) => action.mcpExposed === true).length,
    cliOnlyActionCount: actions.filter((action) => action.mcpExposed !== true).length,
    countsByClass: inventory && inventory.countsByClass ? inventory.countsByClass : {},
    familySummary: buildFamilySummary(actions),
    skillScenarioCatalog: buildSkillScenarioCatalog(),
    supportedJourneyCount: SUPPORTED_SCENARIOS.length,
    supportedJourneyIds: [...SUPPORTED_SCENARIOS],
  };
}

function resolveAcceptanceModeOptions(options = {}) {
  const requestedMode = String(options.mode || '').trim();
  const mode = ACCEPTANCE_MODES.includes(requestedMode) ? requestedMode : DEFAULT_MODE;
  return {
    mode,
    surface: options.surface || DEFAULT_SURFACES.join(','),
    scenario: options.scenario || DEFAULT_JOURNEYS,
    skillScenarioIds:
      Array.isArray(options.skillScenarioIds) && options.skillScenarioIds.length
        ? options.skillScenarioIds
        : (mode === 'fast' ? [...FAST_SKILL_SCENARIO_IDS] : null),
  };
}

async function runAgentAcceptance(options = {}) {
  const modeOptions = resolveAcceptanceModeOptions(options);
  const inventory = buildActionInventory({
    includeCompatibilityAliases: options.includeCompatibilityAliases === true,
  });
  const surfaces = await runSurfaceE2e({
    surface: modeOptions.surface,
    strict: options.strict === true,
    includeCompatibilityAliases: options.includeCompatibilityAliases === true,
    skillExecutor: options.skillExecutor || null,
    skillTimeoutMs: options.skillTimeoutMs || null,
    skillScenarioIds: modeOptions.skillScenarioIds,
  });
  const journeys = await runUserJourneys({
    scenario: modeOptions.scenario,
    keepWorkdir: options.keepWorkdir === true,
  });

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    kind: REPORT_KIND,
    generatedAt: new Date().toISOString(),
    packageVersion: pkg.version,
    mode: modeOptions.mode,
    inventory: buildInventorySummary(inventory),
    surfaces,
    journeys,
    summary: {
      ok: surfaces.ok === true && journeys.ok === true,
      surfaceOk: surfaces.ok === true,
      journeyOk: journeys.ok === true,
      surfaceFailureCount: Array.isArray(surfaces.failureSummary) ? surfaces.failureSummary.length : 0,
      journeyFailureCount: Array.isArray(journeys.failureSummary) ? journeys.failureSummary.length : 0,
      blockedUserGoalCount: journeys.summary && Number(journeys.summary.blockedUserGoalCount) || 0,
      externalPrerequisiteCount: journeys.summary && Number(journeys.summary.externalPrerequisiteCount) || 0,
      skillRuntimeFailureCount:
        surfaces.surfaces
        && surfaces.surfaces['skill-runtime']
        && Array.isArray(surfaces.surfaces['skill-runtime'].failures)
          ? surfaces.surfaces['skill-runtime'].failures.length
          : 0,
    },
    failureSummary: [
      ...(Array.isArray(surfaces.failureSummary) ? surfaces.failureSummary.map((entry) => ({ area: 'surfaces', ...entry })) : []),
      ...(Array.isArray(journeys.failureSummary) ? journeys.failureSummary.map((entry) => ({ area: 'journeys', ...entry })) : []),
    ],
  };
  report.ok = report.summary.ok;
  return report;
}

module.exports = {
  ACCEPTANCE_MODES,
  DEFAULT_JOURNEYS,
  DEFAULT_MODE,
  DEFAULT_SURFACES,
  FAST_SKILL_SCENARIO_IDS,
  REPORT_KIND,
  REPORT_SCHEMA_VERSION,
  buildFamilySummary,
  buildInventorySummary,
  buildSkillScenarioCatalog,
  resolveAcceptanceModeOptions,
  runAgentAcceptance,
};
