const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function requireDep(deps, name) {
  if (!deps || typeof deps[name] !== 'function') {
    throw new Error(`createRunSportsCommand requires deps.${name}()`);
  }
  return deps[name];
}

const SPORTS_USAGE =
  'pandora [--output table|json] sports books list|events list|events live|odds snapshot|consensus|create plan|create run|sync once|sync run|sync start|sync stop|sync status|resolve plan [flags]';

function defaultStateFile() {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';
  return path.join(home, '.pandora', 'sports_sync_state.json');
}

function normalizeBookToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function computeStrategyHash(options) {
  const seed = [
    options.eventId || '',
    options.provider || 'auto',
    options.selection || 'home',
    options.marketType || 'amm',
  ].join('|');
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function readJsonFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort chmod across platforms
  }
}

function resolveRiskThresholds(riskProfile) {
  if (riskProfile === 'aggressive') {
    return {
      maxDataAgeMs: 180_000,
      minCoverageRatio: 0.5,
      maxCoverageDropRatio: 0.4,
      maxSpreadJumpBps: 250,
      maxConsecutiveFailures: 5,
      maxConsecutiveGateFailures: 4,
    };
  }
  if (riskProfile === 'balanced') {
    return {
      maxDataAgeMs: 150_000,
      minCoverageRatio: 0.6,
      maxCoverageDropRatio: 0.3,
      maxSpreadJumpBps: 200,
      maxConsecutiveFailures: 4,
      maxConsecutiveGateFailures: 3,
    };
  }
  return {
    maxDataAgeMs: 120_000,
    minCoverageRatio: 0.7,
    maxCoverageDropRatio: 0.25,
    maxSpreadJumpBps: 150,
    maxConsecutiveFailures: 3,
    maxConsecutiveGateFailures: 2,
  };
}

function toConsensusQuotes(oddsPayload, selection, tier1Books) {
  const books = Array.isArray(oddsPayload && oddsPayload.books) ? oddsPayload.books : [];
  const key = selection === 'away' ? 'away' : selection === 'draw' ? 'draw' : 'home';
  const tier1Set = new Set((Array.isArray(tier1Books) ? tier1Books : []).map((item) => normalizeBookToken(item)));

  return books
    .map((bookRow) => {
      const book = String(bookRow.book || bookRow.bookName || '').trim();
      const price = Number(bookRow && bookRow.outcomes && bookRow.outcomes[key]);
      if (!book || !Number.isFinite(price) || price <= 1) return null;
      return {
        book,
        odds: price,
        oddsFormat: 'decimal',
        tier1: tier1Set.size ? tier1Set.has(normalizeBookToken(book)) : false,
      };
    })
    .filter(Boolean);
}

function renderSportsTable(payload) {
  if (!payload || typeof payload !== 'object') {
    console.log('No data');
    return;
  }

  if (payload.source && payload.source.consensus) {
    const c = payload.source.consensus;
    console.log(`Consensus: yes=${c.consensusYesPct ?? 'n/a'} no=${c.consensusNoPct ?? 'n/a'} confidence=${c.confidence}`);
  }

  if (Array.isArray(payload.events)) {
    console.table(
      payload.events.map((item) => ({
        id: item.id,
        home: item.homeTeam,
        away: item.awayTeam,
        kickoffAt: item.startTime,
        status: item.status,
      })),
    );
    return;
  }

  if (Array.isArray(payload.books)) {
    console.table(payload.books.map((item) => ({ book: item.book, home: item.outcomes.home, draw: item.outcomes.draw, away: item.outcomes.away })));
    return;
  }

  if (payload.timing && payload.timing.creationWindow) {
    console.log(`Creation window: ${payload.timing.creationWindow.status} (open=${payload.timing.creationWindow.opensAt}, close=${payload.timing.creationWindow.closesAt})`);
  }

  console.log('Done.');
}

/**
 * Create sports command runner.
 * @param {object} deps
 * @returns {(args: string[], context: {outputMode: 'table'|'json'}) => Promise<void>}
 */
function createRunSportsCommand(deps) {
  const CliError = requireDep(deps, 'CliError');
  const includesHelpFlag = requireDep(deps, 'includesHelpFlag');
  const emitSuccess = requireDep(deps, 'emitSuccess');
  const commandHelpPayload = requireDep(deps, 'commandHelpPayload');
  const parseSportsFlags = requireDep(deps, 'parseSportsFlags');
  const createSportsProviderRegistry = requireDep(deps, 'createSportsProviderRegistry');
  const computeSportsConsensus = requireDep(deps, 'computeSportsConsensus');
  const buildSportsCreatePlan = requireDep(deps, 'buildSportsCreatePlan');
  const buildSyncStatusPayload = requireDep(deps, 'buildSyncStatusPayload');
  const detectConcurrentSyncConflict = requireDep(deps, 'detectConcurrentSyncConflict');
  const buildSportsResolvePlan = requireDep(deps, 'buildSportsResolvePlan');
  const deployPandoraAmmMarket = requireDep(deps, 'deployPandoraAmmMarket');

  return async function runSportsCommand(args, context) {
    if (!args.length || includesHelpFlag(args)) {
      if (context.outputMode === 'json') {
        emitSuccess(context.outputMode, 'sports.help', commandHelpPayload(SPORTS_USAGE));
      } else {
        console.log(`Usage: ${SPORTS_USAGE}`);
      }
      return;
    }

    const parsed = parseSportsFlags(args);
    const options = parsed.options || {};
    const providerRegistry = createSportsProviderRegistry({ mode: options.provider });

    if (parsed.command === 'sports.books.list') {
      const health = await providerRegistry.health();
      emitSuccess(context.outputMode, parsed.command, {
        provider: options.provider,
        requestedBooks: options.bookPriority,
        health,
        books: options.bookPriority || null,
      }, renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.events.list' || parsed.command === 'sports.events.live') {
      const payload = await providerRegistry.listEvents({
        providerMode: options.provider,
        competitionId: options.competition,
        from: options.kickoffAfter,
        to: options.kickoffBefore,
        status: options.liveOnly ? 'live' : null,
        limit: options.limit,
        timeoutMs: options.timeoutMs,
        sport: 'soccer',
      });
      emitSuccess(context.outputMode, parsed.command, payload, renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.odds.snapshot') {
      const payload = await providerRegistry.getEventOdds(options.eventId, 'soccer_winner');
      const quotes = toConsensusQuotes(payload, options.selection, options.bookPriority || payload.preferredBooks);
      const consensus = computeSportsConsensus(quotes, {
        trimPercent: options.trimPercent,
        minTotalBooks: options.minTotalBooks,
        minTier1Books: options.minTier1Books,
        tier1Books: options.bookPriority || payload.preferredBooks,
      });

      emitSuccess(context.outputMode, parsed.command, {
        ...payload,
        source: {
          provider: payload.provider,
          consensus,
        },
      }, renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.consensus') {
      let quotes;
      let diagnostics = [];
      if (Array.isArray(options.checksJson)) {
        quotes = options.checksJson;
      } else {
        const odds = await providerRegistry.getEventOdds(options.eventId, 'soccer_winner');
        quotes = toConsensusQuotes(odds, options.selection, options.bookPriority || odds.preferredBooks);
        diagnostics = [`quotes:${quotes.length}`];
      }

      const consensus = computeSportsConsensus(quotes, {
        trimPercent: options.trimPercent,
        minTotalBooks: options.minTotalBooks,
        minTier1Books: options.minTier1Books,
        tier1Books: options.bookPriority,
      });
      emitSuccess(context.outputMode, parsed.command, {
        eventId: options.eventId,
        method: options.consensus,
        source: { consensus },
        diagnostics,
      }, renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.create.plan' || parsed.command === 'sports.create.run') {
      const odds = await providerRegistry.getEventOdds(options.eventId, 'soccer_winner');
      const status = await providerRegistry.getEventStatus(options.eventId);
      const event = {
        ...(odds.event || {}),
        status: status.status || (odds.event && odds.event.status) || 'unknown',
      };
      const plan = buildSportsCreatePlan({ event, oddsPayload: odds, options });

      if (parsed.command === 'sports.create.plan') {
        emitSuccess(context.outputMode, parsed.command, plan, renderSportsTable);
        return;
      }

      if (options.execute && !plan.safety.canExecuteCreate) {
        throw new CliError('SPORTS_CREATE_BLOCKED', 'sports create run blocked by conservative timing/coverage gates.', {
          eventId: options.eventId,
          blockedReasons: plan.safety.blockedReasons,
          timing: plan.timing,
          source: plan.source,
        });
      }

      if (plan.marketTemplate.marketType === 'parimutuel') {
        if (options.execute) {
          throw new CliError('UNSUPPORTED_OPERATION', 'sports create run --execute currently supports AMM only.', {
            hints: ['Use sports create plan for parimutuel planning, or launch script for manual execute path.'],
          });
        }
        emitSuccess(context.outputMode, parsed.command, {
          ...plan,
          mode: 'dry-run',
          diagnostics: ['Parimutuel execution is currently planning-only in sports v1.'],
        }, renderSportsTable);
        return;
      }

      const deployment = await deployPandoraAmmMarket({
        question: plan.marketTemplate.question,
        rules: plan.marketTemplate.rules,
        sources: plan.marketTemplate.sources,
        targetTimestamp: plan.marketTemplate.targetTimestamp,
        liquidityUsdc: plan.marketTemplate.liquidityUsdc,
        distributionYes: plan.marketTemplate.distributionYes,
        distributionNo: plan.marketTemplate.distributionNo,
        feeTier: plan.marketTemplate.feeTier,
        maxImbalance: plan.marketTemplate.maxImbalance,
        arbiter: plan.marketTemplate.arbiter,
        category: plan.marketTemplate.category,
        minCloseLeadSeconds: plan.marketTemplate.minCloseLeadSeconds,
        execute: Boolean(options.execute),
        chainId: plan.marketTemplate.chainId,
        rpcUrl: plan.marketTemplate.rpcUrl,
        privateKey: options.privateKey,
        usdc: plan.marketTemplate.usdc,
        oracle: plan.marketTemplate.oracle,
        factory: plan.marketTemplate.factory,
      });

      emitSuccess(context.outputMode, parsed.command, {
        ...plan,
        mode: options.execute ? 'execute' : 'dry-run',
        runtime: {
          mode: 'live',
        },
        deployment,
      }, renderSportsTable);
      return;
    }

    if (parsed.command.startsWith('sports.sync.')) {
      const action = parsed.action;
      const stateFile = options.stateFile || defaultStateFile();
      const strategyHash = computeStrategyHash(options);

      if (action === 'start') {
        const previous = readJsonFile(stateFile);
        const concurrency = detectConcurrentSyncConflict(previous, strategyHash);
        if (concurrency.conflict) {
          throw new CliError('SPORTS_SYNC_ALREADY_RUNNING', 'sports sync start blocked because a sync runtime is already active for this state file.', {
            stateFile,
            strategyHash,
            reason: concurrency.reason,
            existingStrategyHash: concurrency.existingStrategyHash,
          });
        }
        const state = {
          running: true,
          strategyHash,
          startedAt: new Date().toISOString(),
          options,
        };
        writeJsonFile(stateFile, state);
        const payload = buildSyncStatusPayload('start', {
          alive: true,
          found: true,
          pid: process.pid,
          pidFile: stateFile,
          strategyHash,
          now: new Date().toISOString(),
          thresholds: resolveRiskThresholds(options.riskProfile),
        });
        emitSuccess(context.outputMode, parsed.command, payload, renderSportsTable);
        return;
      }

      if (action === 'stop') {
        const previous = readJsonFile(stateFile);
        const payload = buildSyncStatusPayload('stop', {
          alive: false,
          found: Boolean(previous),
          pid: previous && previous.pid ? previous.pid : null,
          pidFile: stateFile,
          strategyHash: previous && previous.strategyHash ? previous.strategyHash : strategyHash,
          now: new Date().toISOString(),
          thresholds: resolveRiskThresholds(options.riskProfile),
        });
        if (previous) {
          writeJsonFile(stateFile, {
            ...previous,
            running: false,
            stoppedAt: new Date().toISOString(),
          });
        }
        emitSuccess(context.outputMode, parsed.command, payload, renderSportsTable);
        return;
      }

      if (action === 'status') {
        const state = readJsonFile(stateFile);
        const payload = buildSyncStatusPayload('status', {
          alive: Boolean(state && state.running),
          found: Boolean(state),
          pidFile: stateFile,
          strategyHash: state && state.strategyHash ? state.strategyHash : strategyHash,
          now: new Date().toISOString(),
          thresholds: resolveRiskThresholds(options.riskProfile),
        });
        emitSuccess(context.outputMode, parsed.command, payload, renderSportsTable);
        return;
      }

      const odds = await providerRegistry.getEventOdds(options.eventId, 'soccer_winner');
      const status = await providerRegistry.getEventStatus(options.eventId);
      const quotes = toConsensusQuotes(odds, options.selection, options.bookPriority || odds.preferredBooks);
      const consensus = computeSportsConsensus(quotes, {
        trimPercent: options.trimPercent,
        minTotalBooks: options.minTotalBooks,
        minTier1Books: options.minTier1Books,
        tier1Books: options.bookPriority || odds.preferredBooks,
      });

      const updatedAt = Date.parse(odds.updatedAt || status.updatedAt || new Date().toISOString());
      const dataAgeMs = Number.isFinite(updatedAt) ? Math.max(0, Date.now() - updatedAt) : 0;
      const coverageRatio = consensus.totalBooks > 0 ? consensus.includedBooks / consensus.totalBooks : 0;
      const spreadBps = Number.isFinite(consensus.consensusYesPct)
        ? Math.round(Math.abs(consensus.consensusYesPct - 50) * 100)
        : 0;

      const payload = buildSyncStatusPayload(action === 'once' ? 'once' : 'run', {
        now: new Date().toISOString(),
        event: {
          startAt: odds.event && odds.event.startTime,
          status: status.status,
          nearSettle: String(status.status || '').toLowerCase().includes('final'),
        },
        cadenceMs: {
          prematch: options.syncCadencePrematchMs,
          live: options.syncCadenceLiveMs,
          'near-settle': options.syncCadenceNearSettleMs,
        },
        dataAgeMs,
        coverageRatio,
        spreadBps,
        consecutiveFailures: 0,
        consecutiveGateFailures: 0,
        gatePassed: consensus.confidence !== 'insufficient',
        thresholds: resolveRiskThresholds(options.riskProfile),
        strategyHash,
        pidFile: stateFile,
      });

      emitSuccess(context.outputMode, parsed.command, {
        ...payload,
        runtime: {
          mode: 'live',
          executionMode: options.paper ? 'paper' : 'execute',
        },
        source: {
          provider: options.provider,
          consensus,
        },
        event: odds.event,
      }, renderSportsTable);
      return;
    }

    if (parsed.command === 'sports.resolve.plan') {
      let checks = [];
      if (Array.isArray(options.checksJson)) {
        checks = options.checksJson;
      } else if (options.checksFile) {
        const filePayload = readJsonFile(options.checksFile);
        checks = Array.isArray(filePayload) ? filePayload : [];
      } else {
        const status = await providerRegistry.getEventStatus(options.eventId);
        checks = [
          {
            checkId: `status-${Date.now()}`,
            checkedAt: status.updatedAt || new Date().toISOString(),
            sources: [
              {
                name: 'official-feed',
                official: true,
                finalResult: status.finalResult || status.result || null,
                checkedAt: status.updatedAt || new Date().toISOString(),
              },
            ],
          },
        ];
      }

      const plan = buildSportsResolvePlan({
        pollAddress: options.pollAddress,
        reason: options.reason,
        checks,
        settleDelayMs: options.settleDelayMs,
        consecutiveChecksRequired: options.consecutiveChecksRequired,
        now: options.now || options.nowMs || new Date().toISOString(),
      });

      if (!plan.safeToResolve) {
        throw new CliError('SPORTS_RESOLVE_PLAN_UNSAFE', 'sports resolve plan is not safe yet.', {
          eventId: options.eventId,
          plan,
        });
      }

      emitSuccess(context.outputMode, parsed.command, {
        ...plan,
        timing: {
          statusConfidence: 'high',
          warnings: [],
        },
      }, renderSportsTable);
      return;
    }

    throw new CliError('INVALID_USAGE', `Unsupported sports command: ${parsed.command}`);
  };
}

module.exports = {
  createRunSportsCommand,
  SPORTS_USAGE,
};
