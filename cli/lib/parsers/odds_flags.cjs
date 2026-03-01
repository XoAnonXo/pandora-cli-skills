function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createParseOddsFlags requires deps.${name}()`);
  }
  return deps[name];
}

function parseOutputFormat(value, CliError) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!['json', 'csv'].includes(normalized)) {
    throw new CliError('INVALID_FLAG_VALUE', '--output must be csv|json for odds history.');
  }
  return normalized;
}

function parseVenueList(raw, parseCsvList) {
  return parseCsvList(raw, '--venues')
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Create parser for `odds` command family.
 * @param {object} deps
 * @returns {(args: string[]) => {action: string, options: object}}
 */
function createParseOddsFlags(deps) {
  const CliError = requireDep(deps, 'CliError');
  const requireFlagValue = requireDep(deps, 'requireFlagValue');
  const parsePositiveInteger = requireDep(deps, 'parsePositiveInteger');
  const parseCsvList = requireDep(deps, 'parseCsvList');

  return function parseOddsFlags(args) {
    const action = String((args && args[0]) || '').trim().toLowerCase();
    if (!action || !['record', 'history'].includes(action)) {
      throw new CliError('INVALID_ARGS', 'odds requires subcommand: record|history.');
    }

    const rest = args.slice(1);
    if (action === 'record') {
      const options = {
        competition: null,
        intervalSec: null,
        maxSamples: 1,
        eventId: null,
        venues: ['pandora_amm', 'polymarket'],
        indexerUrl: null,
        polymarketHost: null,
        polymarketMockUrl: null,
        timeoutMs: null,
      };

      for (let i = 0; i < rest.length; i += 1) {
        const token = rest[i];
        if (token === '--competition') {
          options.competition = requireFlagValue(rest, i, '--competition');
          i += 1;
          continue;
        }
        if (token === '--interval') {
          options.intervalSec = parsePositiveInteger(requireFlagValue(rest, i, '--interval'), '--interval');
          i += 1;
          continue;
        }
        if (token === '--max-samples') {
          options.maxSamples = parsePositiveInteger(requireFlagValue(rest, i, '--max-samples'), '--max-samples');
          i += 1;
          continue;
        }
        if (token === '--event-id') {
          options.eventId = requireFlagValue(rest, i, '--event-id');
          i += 1;
          continue;
        }
        if (token === '--venues') {
          options.venues = parseVenueList(requireFlagValue(rest, i, '--venues'), parseCsvList);
          i += 1;
          continue;
        }
        if (token === '--indexer-url') {
          options.indexerUrl = requireFlagValue(rest, i, '--indexer-url');
          i += 1;
          continue;
        }
        if (token === '--polymarket-host') {
          options.polymarketHost = requireFlagValue(rest, i, '--polymarket-host');
          i += 1;
          continue;
        }
        if (token === '--polymarket-mock-url') {
          options.polymarketMockUrl = requireFlagValue(rest, i, '--polymarket-mock-url');
          i += 1;
          continue;
        }
        if (token === '--timeout-ms') {
          options.timeoutMs = parsePositiveInteger(requireFlagValue(rest, i, '--timeout-ms'), '--timeout-ms');
          i += 1;
          continue;
        }
        throw new CliError('UNKNOWN_FLAG', `Unknown flag for odds record: ${token}`);
      }

      if (!options.competition) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'odds record requires --competition <id>.');
      }
      if (!options.intervalSec) {
        throw new CliError('MISSING_REQUIRED_FLAG', 'odds record requires --interval <sec>.');
      }

      return {
        action,
        options,
      };
    }

    const options = {
      eventId: null,
      output: 'json',
      limit: 1000,
    };
    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i];
      if (token === '--event-id') {
        options.eventId = requireFlagValue(rest, i, '--event-id');
        i += 1;
        continue;
      }
      if (token === '--output') {
        options.output = parseOutputFormat(requireFlagValue(rest, i, '--output'), CliError);
        i += 1;
        continue;
      }
      if (token === '--limit') {
        options.limit = parsePositiveInteger(requireFlagValue(rest, i, '--limit'), '--limit');
        i += 1;
        continue;
      }
      throw new CliError('UNKNOWN_FLAG', `Unknown flag for odds history: ${token}`);
    }

    if (!options.eventId) {
      throw new CliError('MISSING_REQUIRED_FLAG', 'odds history requires --event-id <id>.');
    }

    return {
      action,
      options,
    };
  };
}

module.exports = {
  createParseOddsFlags,
};
