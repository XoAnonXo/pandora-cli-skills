'use strict';

const POLICY_SCHEMA_VERSION = '1.0.0';
const POLICY_STORE_SCHEMA_VERSION = POLICY_SCHEMA_VERSION;
const POLICY_PACK_KIND = 'policy-pack';
const DEFAULT_POLICY_DIR = '.pandora/policies';
const POLICY_FILE_EXTENSION = '.json';
const POLICY_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const POLICY_RULE_EFFECTS = Object.freeze(['deny', 'warn']);
const POLICY_RULE_KINDS = Object.freeze([
  'allow_commands_only',
  'allow_external_dependencies',
  'allow_input_enum',
  'deny_commands',
  'deny_live_execution',
  'deny_mutating',
  'max_context_number',
  'max_input_number',
  'require_agent_preflight',
  'require_no_direct_secrets',
  'require_safe_mode',
  'require_validation',
  'require_validation_support',
  'require_webhook_for_long_running',
]);

const POLICY_MATCH_FIELDS = Object.freeze([
  'commandKnown',
  'commands',
  'commandPrefixes',
  'jobCapable',
  'liveRequested',
  'longRunning',
  'mutating',
  'policyScopesAny',
  'requiresSecrets',
  'riskLevels',
  'safeModeRequested',
  'validationSupported',
]);

const POLICY_DESCRIPTOR_RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'critical']);
const POLICY_CONTEXT_FIELDS = Object.freeze([
  'activeOperationCount',
  'notionalUsd',
  'notionalUsdc',
  'projectedTradesToday',
  'runtimeSeconds',
]);

const POLICY_EXTERNAL_DEPENDENCIES = Object.freeze([
  'chain-rpc',
  'filesystem',
  'indexer-api',
  'notification-secrets',
  'polymarket-api',
  'sports-data-provider',
  'stdio-transport',
  'wallet-secrets',
  'webhook-endpoint',
]);

const POLICY_REMEDIATION_ACTION_TYPES = Object.freeze([
  'provide_context',
  'provide_input',
  'run_command',
  'set_input',
  'switch_policy_pack',
  'use_profile',
]);

const BUILTIN_POLICY_PACK_IDS = Object.freeze([
  'research-only',
  'paper-trading',
  'execute-with-validation',
  'execute-with-risk-cap',
  'market-creation-conservative',
]);

module.exports = {
  POLICY_SCHEMA_VERSION,
  POLICY_STORE_SCHEMA_VERSION,
  POLICY_PACK_KIND,
  DEFAULT_POLICY_DIR,
  POLICY_FILE_EXTENSION,
  POLICY_ID_PATTERN,
  POLICY_RULE_EFFECTS,
  POLICY_RULE_KINDS,
  POLICY_MATCH_FIELDS,
  POLICY_DESCRIPTOR_RISK_LEVELS,
  POLICY_CONTEXT_FIELDS,
  POLICY_EXTERNAL_DEPENDENCIES,
  POLICY_REMEDIATION_ACTION_TYPES,
  BUILTIN_POLICY_PACK_IDS,
};
