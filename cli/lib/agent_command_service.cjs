const {
  buildAgentMarketHypePayload,
  buildAgentMarketAutocompletePayload,
  buildAgentMarketValidationPayload,
} = require('./agent_market_prompt_service.cjs');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunAgentCommand requires deps.${name}()`);
  }
  return deps[name];
}

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (typeof value !== 'string' || value.startsWith('--')) {
    const error = new Error(`${flagName} requires a value.`);
    error.code = 'MISSING_FLAG_VALUE';
    throw error;
  }
  return value;
}

function parseAgentMarketAutocompleteFlags(args) {
  const options = {
    question: '',
    marketType: 'amm',
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--question') {
      options.question = readFlagValue(args, i, '--question');
      i += 1;
      continue;
    }
    if (token === '--market-type') {
      options.marketType = readFlagValue(args, i, '--market-type');
      i += 1;
      continue;
    }
    const error = new Error(`Unknown flag for agent market autocomplete: ${token}`);
    error.code = 'UNKNOWN_FLAG';
    throw error;
  }

  if (!String(options.question || '').trim()) {
    const error = new Error('agent market autocomplete requires --question <text>.');
    error.code = 'MISSING_REQUIRED_FLAG';
    throw error;
  }

  return options;
}

function parseAgentMarketHypeFlags(args) {
  const options = {
    area: '',
    region: '',
    query: '',
    marketType: 'auto',
    candidateCount: 3,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--area') {
      options.area = readFlagValue(args, i, '--area');
      i += 1;
      continue;
    }
    if (token === '--region') {
      options.region = readFlagValue(args, i, '--region');
      i += 1;
      continue;
    }
    if (token === '--query') {
      options.query = readFlagValue(args, i, '--query');
      i += 1;
      continue;
    }
    if (token === '--market-type') {
      options.marketType = readFlagValue(args, i, '--market-type');
      i += 1;
      continue;
    }
    if (token === '--candidate-count') {
      const raw = readFlagValue(args, i, '--candidate-count');
      const numeric = Number(raw);
      if (!Number.isInteger(numeric) || numeric <= 0) {
        const error = new Error('--candidate-count must be a positive integer.');
        error.code = 'INVALID_FLAG_VALUE';
        throw error;
      }
      if (numeric > 5) {
        const error = new Error('--candidate-count must be between 1 and 5.');
        error.code = 'INVALID_FLAG_VALUE';
        throw error;
      }
      options.candidateCount = numeric;
      i += 1;
      continue;
    }
    const error = new Error(`Unknown flag for agent market hype: ${token}`);
    error.code = 'UNKNOWN_FLAG';
    throw error;
  }

  if (!String(options.area || '').trim()) {
    const error = new Error('agent market hype requires --area <text>.');
    error.code = 'MISSING_REQUIRED_FLAG';
    throw error;
  }

  if (['regional-news', 'regional', 'local-news'].includes(String(options.area || '').trim().toLowerCase()) && !String(options.region || '').trim()) {
    const error = new Error('agent market hype requires --region <text> when --area regional-news.');
    error.code = 'MISSING_REQUIRED_FLAG';
    throw error;
  }

  return options;
}

function parseAgentMarketValidateFlags(args) {
  const options = {
    question: '',
    rules: '',
    sources: [],
    targetTimestamp: 0,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--question') {
      options.question = readFlagValue(args, i, '--question');
      i += 1;
      continue;
    }
    if (token === '--rules') {
      options.rules = readFlagValue(args, i, '--rules');
      i += 1;
      continue;
    }
    if (token === '--target-timestamp') {
      const raw = readFlagValue(args, i, '--target-timestamp');
      const numeric = Number(raw);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        const error = new Error('--target-timestamp must be a unix timestamp in seconds.');
        error.code = 'INVALID_FLAG_VALUE';
        throw error;
      }
      options.targetTimestamp = Math.trunc(numeric);
      i += 1;
      continue;
    }
    if (token === '--sources') {
      let consumed = 0;
      for (let j = i + 1; j < args.length; j += 1) {
        const value = args[j];
        if (typeof value !== 'string' || value.startsWith('--')) break;
        options.sources.push(value);
        consumed += 1;
      }
      if (!consumed) {
        const error = new Error('--sources requires at least one URL value.');
        error.code = 'MISSING_FLAG_VALUE';
        throw error;
      }
      i += consumed;
      continue;
    }
    if (token === '--source') {
      options.sources.push(readFlagValue(args, i, '--source'));
      i += 1;
      continue;
    }
    const error = new Error(`Unknown flag for agent market validate: ${token}`);
    error.code = 'UNKNOWN_FLAG';
    throw error;
  }

  if (!String(options.question || '').trim()) {
    const error = new Error('agent market validate requires --question <text>.');
    error.code = 'MISSING_REQUIRED_FLAG';
    throw error;
  }
  if (!String(options.rules || '').trim()) {
    const error = new Error('agent market validate requires --rules <text>.');
    error.code = 'MISSING_REQUIRED_FLAG';
    throw error;
  }
  if (!options.targetTimestamp) {
    const error = new Error('agent market validate requires --target-timestamp <unix-seconds>.');
    error.code = 'MISSING_REQUIRED_FLAG';
    throw error;
  }

  return options;
}

function renderAgentPromptTable(payload) {
  const lines = [
    `${payload.promptKind} (${payload.promptVersion})`,
  ];
  if (payload.ticket) {
    lines.push(`ticket: ${payload.ticket}`);
  }
  lines.push('');
  lines.push('Prompt:');
  lines.push(payload.prompt);
  lines.push('');
  lines.push('Workflow:');
  for (const note of payload.workflow && Array.isArray(payload.workflow.notes) ? payload.workflow.notes : []) {
    lines.push(`- ${note}`);
  }
  if (payload.requiredAttestation) {
    lines.push('');
    lines.push('Required attestation:');
    lines.push(JSON.stringify(payload.requiredAttestation, null, 2));
  }
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

function createRunAgentCommand(deps) {
  const CliError = deps.CliError;
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');

  if (typeof CliError !== 'function') {
    throw new Error('createRunAgentCommand requires deps.CliError.');
  }

  async function runAgentCommand(args, context) {
    const rest = Array.isArray(args) ? args : [];
    if (!rest.length || includesHelpFlag(rest)) {
      const usage = [
        'pandora [--output table|json] agent market hype --area <sports|esports|politics|regional-news|breaking-news> [--region <text>] [--query <text>] [--market-type auto|amm|parimutuel|both] [--candidate-count <n>]',
        'pandora [--output table|json] agent market autocomplete --question <text> [--market-type amm|parimutuel]',
        'pandora [--output table|json] agent market validate --question <text> --rules <text> --target-timestamp <unix-seconds> [--sources <url...>]',
      ];
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'agent.help', commandHelpPayload(usage));
      } else {
        renderAgentPromptTable({
          promptKind: 'agent.help',
          promptVersion: 'n/a',
          ticket: null,
          prompt: usage.join('\n'),
          workflow: {
            notes: [
              'Use agent market hype when the agent must research current trending topics before drafting a market.',
              'When --area regional-news is selected, always pass --region <text> so the research stays local.',
              'Use agent market autocomplete when the agent must draft market rules or timing.',
              'Use agent market validate before any agent-exposed market execute path.',
            ],
          },
        });
      }
      return;
    }

    const namespace = rest[0];
    const action = rest[1];
    const actionArgs = rest.slice(2);

    if (namespace !== 'market') {
      throw new CliError('INVALID_ARGS', 'agent requires subcommand: market autocomplete|validate');
    }

    if (action === 'autocomplete') {
      const payload = buildAgentMarketAutocompletePayload(parseAgentMarketAutocompleteFlags(actionArgs));
      emitSuccess(context.outputMode, 'agent.market.autocomplete', payload, renderAgentPromptTable);
      return;
    }

    if (action === 'hype') {
      const payload = buildAgentMarketHypePayload(parseAgentMarketHypeFlags(actionArgs));
      emitSuccess(context.outputMode, 'agent.market.hype', payload, renderAgentPromptTable);
      return;
    }

    if (action === 'validate') {
      const payload = buildAgentMarketValidationPayload(parseAgentMarketValidateFlags(actionArgs));
      emitSuccess(context.outputMode, 'agent.market.validate', payload, renderAgentPromptTable);
      return;
    }

    throw new CliError('INVALID_ARGS', 'agent market requires subcommand: hype|autocomplete|validate');
  }

  return {
    runAgentCommand,
  };
}

module.exports = {
  createRunAgentCommand,
};
