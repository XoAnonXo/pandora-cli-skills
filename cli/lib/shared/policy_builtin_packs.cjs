'use strict';

const { POLICY_PACK_KIND, POLICY_SCHEMA_VERSION } = require('./policy_constants.cjs');
const {
  PROFILE_DEFAULT_LOCAL_ENV_PROFILE_ID,
  PROFILE_DEFAULT_READ_ONLY_PROFILE_ID,
} = require('./profile_constants.cjs');

const BUILTIN_POLICY_PACKS = Object.freeze([
  Object.freeze({
    schemaVersion: POLICY_SCHEMA_VERSION,
    kind: POLICY_PACK_KIND,
    id: 'research-only',
    version: '1.0.0',
    displayName: 'Research Only',
    description: 'Read-only analysis mode. Denies mutating execution paths and direct secret injection.',
    notes: ['Use for discovery, schema/capabilities inspection, planning, and validation-only workflows.'],
    rules: [
      {
        id: 'deny-mutating',
        kind: 'deny_mutating',
        result: {
          code: 'POLICY_RESEARCH_ONLY_MUTATION_DENIED',
          message: 'research-only blocks mutating or write-scoped commands.',
          remediation: {
            summary: 'Use a read-only command or switch to a safer execution pack.',
            actions: [
              { type: 'switch_policy_pack', packId: 'paper-trading' },
              { type: 'run_command', command: 'capabilities', reason: 'Inspect safe command families first.' },
            ],
          },
        },
      },
      {
        id: 'deny-direct-secrets',
        kind: 'require_no_direct_secrets',
        result: {
          code: 'POLICY_RESEARCH_ONLY_SECRET_DENIED',
          message: 'research-only does not permit direct secret material in requests.',
          remediation: {
            summary: 'Remove direct private keys or tokens and use non-signing flows instead.',
            actions: [
              { type: 'use_profile', profileId: PROFILE_DEFAULT_READ_ONLY_PROFILE_ID },
              { type: 'set_input', field: 'private-key', value: null },
            ],
          },
        },
      },
    ],
  }),
  Object.freeze({
    schemaVersion: POLICY_SCHEMA_VERSION,
    kind: POLICY_PACK_KIND,
    id: 'paper-trading',
    version: '1.0.0',
    displayName: 'Paper Trading',
    description: 'Allows mutating workflows only when explicitly forced into paper or dry-run mode.',
    notes: ['Use for shadow execution and rehearsal before switching to a live pack.'],
    rules: [
      {
        id: 'require-safe-mode',
        kind: 'require_safe_mode',
        match: { mutating: true },
        result: {
          code: 'POLICY_PAPER_TRADING_SAFE_MODE_REQUIRED',
          message: 'paper-trading requires a safe execution flag for mutating commands.',
          remediation: {
            summary: 'Re-run the command in paper or dry-run mode.',
            actions: [
              { type: 'set_input', field: 'paper', value: true },
              { type: 'set_input', field: 'dry-run', value: true },
            ],
          },
        },
      },
      {
        id: 'deny-live-execution',
        kind: 'deny_live_execution',
        match: { mutating: true, liveRequested: true },
        result: {
          code: 'POLICY_PAPER_TRADING_LIVE_DENIED',
          message: 'paper-trading forbids live execution flags.',
          remediation: {
            summary: 'Remove live execute flags and keep the workflow in simulation mode.',
            actions: [
              { type: 'set_input', field: 'execute', value: false },
              { type: 'set_input', field: 'execute-live', value: false },
            ],
          },
        },
      },
      {
        id: 'deny-direct-secrets',
        kind: 'require_no_direct_secrets',
        match: { mutating: true },
        result: {
          code: 'POLICY_PAPER_TRADING_SECRET_DENIED',
          message: 'paper-trading does not accept direct secret material.',
          remediation: {
            summary: 'Use profile-backed or non-signing execution inputs.',
            actions: [{ type: 'use_profile', profileId: PROFILE_DEFAULT_READ_ONLY_PROFILE_ID }],
          },
        },
      },
    ],
  }),
  Object.freeze({
    schemaVersion: POLICY_SCHEMA_VERSION,
    kind: POLICY_PACK_KIND,
    id: 'execute-with-validation',
    version: '1.0.0',
    displayName: 'Execute With Validation',
    description: 'Allows live execution only for commands that expose a validation path and supply a valid attestation.',
    notes: ['Designed for agent-mediated execution where validation/preflight metadata must be present.'],
    rules: [
      {
        id: 'require-validation-support',
        kind: 'require_validation_support',
        match: { mutating: true, liveRequested: true },
        result: {
          code: 'POLICY_EXECUTE_VALIDATION_SUPPORT_REQUIRED',
          message: 'This policy only allows live execution for commands with a validation/preflight contract.',
          remediation: {
            summary: 'Use a safe mode, a preflight-only tool, or a different policy pack for this command.',
            actions: [
              { type: 'run_command', command: 'agent.market.validate', reason: 'Generate an attestation when supported.' },
              { type: 'switch_policy_pack', packId: 'paper-trading' },
            ],
          },
        },
      },
      {
        id: 'require-validation-ticket',
        kind: 'require_validation',
        match: { mutating: true, liveRequested: true },
        acceptedDecisions: ['PASS'],
        result: {
          code: 'POLICY_EXECUTE_VALIDATION_REQUIRED',
          message: 'Live execution requires a validation ticket and a non-failing validation verdict.',
          remediation: {
            summary: 'Run the validation workflow and attach the returned ticket/attestation.',
            actions: [
              { type: 'provide_context', field: 'validationTicket' },
              { type: 'provide_context', field: 'validationDecision', value: 'PASS' },
              { type: 'run_command', command: 'agent.market.validate' },
            ],
          },
        },
      },
      {
        id: 'require-agent-preflight',
        kind: 'require_agent_preflight',
        match: { mutating: true, liveRequested: true },
        result: {
          code: 'POLICY_EXECUTE_PREFLIGHT_REQUIRED',
          message: 'Live execution requires the agentPreflight attestation on commands that declare it.',
          remediation: {
            summary: 'Attach the full agentPreflight object from the validation flow.',
            actions: [{ type: 'provide_input', field: 'agentPreflight' }],
          },
        },
      },
      {
        id: 'deny-direct-secrets',
        kind: 'require_no_direct_secrets',
        match: { mutating: true, liveRequested: true },
        result: {
          code: 'POLICY_EXECUTE_SECRET_DENIED',
          message: 'This pack forbids direct private-key or token injection during live execution.',
          remediation: {
            summary: 'Move signing material into an approved profile or signer flow.',
            actions: [{ type: 'use_profile', profileId: PROFILE_DEFAULT_LOCAL_ENV_PROFILE_ID }],
          },
        },
      },
    ],
  }),
  Object.freeze({
    schemaVersion: POLICY_SCHEMA_VERSION,
    kind: POLICY_PACK_KIND,
    id: 'execute-with-risk-cap',
    version: '1.0.0',
    displayName: 'Execute With Risk Cap',
    description: 'Validation-gated live execution with explicit notional and operational ceilings.',
    extends: ['execute-with-validation'],
    notes: ['Use for constrained live trading and mirroring.'],
    rules: [
      {
        id: 'cap-notional-context',
        kind: 'max_context_number',
        match: { mutating: true, liveRequested: true },
        field: 'notionalUsdc',
        limit: 500,
        result: {
          code: 'POLICY_RISK_CAP_NOTIONAL_EXCEEDED',
          message: 'Live notional exceeds the execute-with-risk-cap ceiling.',
          remediation: {
            summary: 'Reduce the requested notional or switch to a wider live-execution policy.',
            actions: [{ type: 'provide_context', field: 'notionalUsdc' }],
          },
        },
      },
      {
        id: 'cap-liquidity',
        kind: 'max_input_number',
        match: { mutating: true, liveRequested: true },
        field: 'liquidity-usdc',
        limit: 500,
        result: {
          code: 'POLICY_RISK_CAP_LIQUIDITY_EXCEEDED',
          message: 'Requested liquidity exceeds the execute-with-risk-cap limit.',
          remediation: {
            summary: 'Lower --liquidity-usdc before retrying.',
            actions: [{ type: 'set_input', field: 'liquidity-usdc' }],
          },
        },
      },
      {
        id: 'cap-amount',
        kind: 'max_input_number',
        match: { mutating: true, liveRequested: true },
        field: 'amount-usdc',
        limit: 500,
        result: {
          code: 'POLICY_RISK_CAP_AMOUNT_EXCEEDED',
          message: 'Requested trade size exceeds the execute-with-risk-cap limit.',
          remediation: {
            summary: 'Lower --amount-usdc before retrying.',
            actions: [{ type: 'set_input', field: 'amount-usdc' }],
          },
        },
      },
      {
        id: 'cap-open-exposure',
        kind: 'max_input_number',
        match: { mutating: true, liveRequested: true },
        field: 'max-open-exposure-usdc',
        limit: 500,
        result: {
          code: 'POLICY_RISK_CAP_OPEN_EXPOSURE_EXCEEDED',
          message: 'Open exposure cap exceeds the policy limit.',
          remediation: {
            summary: 'Lower --max-open-exposure-usdc before retrying.',
            actions: [{ type: 'set_input', field: 'max-open-exposure-usdc' }],
          },
        },
      },
      {
        id: 'cap-rebalance',
        kind: 'max_input_number',
        match: { mutating: true, liveRequested: true },
        field: 'max-rebalance-usdc',
        limit: 250,
        result: {
          code: 'POLICY_RISK_CAP_REBALANCE_EXCEEDED',
          message: 'Rebalance size exceeds the policy limit.',
          remediation: {
            summary: 'Lower --max-rebalance-usdc before retrying.',
            actions: [{ type: 'set_input', field: 'max-rebalance-usdc' }],
          },
        },
      },
      {
        id: 'cap-hedge',
        kind: 'max_input_number',
        match: { mutating: true, liveRequested: true },
        field: 'max-hedge-usdc',
        limit: 250,
        result: {
          code: 'POLICY_RISK_CAP_HEDGE_EXCEEDED',
          message: 'Hedge size exceeds the policy limit.',
          remediation: {
            summary: 'Lower --max-hedge-usdc before retrying.',
            actions: [{ type: 'set_input', field: 'max-hedge-usdc' }],
          },
        },
      },
      {
        id: 'cap-max-trades',
        kind: 'max_input_number',
        match: { mutating: true, liveRequested: true },
        field: 'max-trades-per-day',
        limit: 10,
        result: {
          code: 'POLICY_RISK_CAP_TRADES_EXCEEDED',
          message: 'The requested daily trade ceiling exceeds the policy limit.',
          remediation: {
            summary: 'Lower --max-trades-per-day before retrying.',
            actions: [{ type: 'set_input', field: 'max-trades-per-day' }],
          },
        },
      },
      {
        id: 'cap-active-operations',
        kind: 'max_context_number',
        match: { mutating: true, liveRequested: true },
        field: 'activeOperationCount',
        limit: 3,
        result: {
          code: 'POLICY_RISK_CAP_ACTIVE_OPERATIONS_EXCEEDED',
          message: 'Too many active live operations are already in flight for this pack.',
          remediation: {
            summary: 'Wait for current operations to complete or close before adding more.',
            actions: [{ type: 'provide_context', field: 'activeOperationCount' }],
          },
        },
      },
    ],
  }),
  Object.freeze({
    schemaVersion: POLICY_SCHEMA_VERSION,
    kind: POLICY_PACK_KIND,
    id: 'market-creation-conservative',
    version: '1.0.0',
    displayName: 'Market Creation Conservative',
    description: 'A conservative allowlist and cap set for launch, sports creation, and one-shot mirror deployment.',
    extends: ['execute-with-validation'],
    notes: ['Intentionally excludes ongoing mirror sync loops and general trading tools.'],
    rules: [
      {
        id: 'allow-market-creation-surface',
        kind: 'allow_commands_only',
        commands: [
          'agent.market.autocomplete',
          'agent.market.validate',
          'capabilities',
          'clone-bet',
          'launch',
          'mirror.deploy',
          'mirror.hedge-calc',
          'mirror.lp-explain',
          'mirror.plan',
          'mirror.simulate',
          'operations.get',
          'operations.list',
          'schema',
          'sports.create.plan',
          'sports.create.run',
        ],
        result: {
          code: 'POLICY_MARKET_CREATION_COMMAND_DENIED',
          message: 'market-creation-conservative only allows market design and single-shot creation/deploy workflows.',
          remediation: {
            summary: 'Switch to a broader execution pack for trading or sync loops.',
            actions: [{ type: 'switch_policy_pack', packId: 'execute-with-risk-cap' }],
          },
        },
      },
      {
        id: 'allow-market-creation-dependencies',
        kind: 'allow_external_dependencies',
        dependencies: ['chain-rpc', 'filesystem', 'polymarket-api', 'sports-data-provider', 'wallet-secrets'],
        result: {
          code: 'POLICY_MARKET_CREATION_DEPENDENCY_DENIED',
          message: 'This pack only permits the dependency surface expected for conservative market creation.',
          remediation: {
            summary: 'Avoid broader network integrations or use a different pack.',
            actions: [{ type: 'run_command', command: 'capabilities' }],
          },
        },
      },
      {
        id: 'cap-market-liquidity',
        kind: 'max_input_number',
        match: { mutating: true, liveRequested: true },
        field: 'liquidity-usdc',
        limit: 250,
        result: {
          code: 'POLICY_MARKET_CREATION_LIQUIDITY_EXCEEDED',
          message: 'Initial liquidity exceeds the conservative market-creation cap.',
          remediation: {
            summary: 'Lower --liquidity-usdc before retrying.',
            actions: [{ type: 'set_input', field: 'liquidity-usdc' }],
          },
        },
      },
      {
        id: 'cap-market-fee-tier',
        kind: 'max_input_number',
        match: { mutating: true, liveRequested: true },
        field: 'fee-tier',
        limit: 3000,
        result: {
          code: 'POLICY_MARKET_CREATION_FEE_TIER_EXCEEDED',
          message: 'Fee tier exceeds the conservative market-creation ceiling.',
          remediation: {
            summary: 'Lower --fee-tier before retrying.',
            actions: [{ type: 'set_input', field: 'fee-tier' }],
          },
        },
      },
      {
        id: 'cap-market-open-exposure',
        kind: 'max_input_number',
        match: { mutating: true, liveRequested: true },
        field: 'max-open-exposure-usdc',
        limit: 250,
        result: {
          code: 'POLICY_MARKET_CREATION_OPEN_EXPOSURE_EXCEEDED',
          message: 'Open exposure ceiling exceeds the conservative market-creation limit.',
          remediation: {
            summary: 'Lower --max-open-exposure-usdc before retrying.',
            actions: [{ type: 'set_input', field: 'max-open-exposure-usdc' }],
          },
        },
      },
      {
        id: 'cap-market-runtime-notional',
        kind: 'max_context_number',
        match: { mutating: true, liveRequested: true },
        field: 'notionalUsdc',
        limit: 250,
        result: {
          code: 'POLICY_MARKET_CREATION_NOTIONAL_EXCEEDED',
          message: 'Live market-creation notional exceeds the conservative limit.',
          remediation: {
            summary: 'Reduce the requested runtime notional before retrying.',
            actions: [{ type: 'provide_context', field: 'notionalUsdc' }],
          },
        },
      },
    ],
  }),
]);

module.exports = {
  BUILTIN_POLICY_PACKS,
};
