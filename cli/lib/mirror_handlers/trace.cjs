function renderKeyValueRows(title, rows) {
  console.log(title);
  for (const [label, value] of rows) {
    const rendered =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    console.log(`${label}: ${rendered}`);
  }
}

function formatArchiveRequirement(summary = {}) {
  if (summary.archiveRequirement === 'depends-on-history-depth') {
    return 'depends on history depth';
  }
  if (summary.archiveRequirement === 'not-required') {
    return 'no';
  }
  if (summary.archiveRequirement === 'required') {
    return 'yes';
  }
  if (summary.archiveRequired === null || summary.archiveRequired === undefined) {
    return '';
  }
  return summary.archiveRequired ? 'yes' : 'no';
}

function renderMirrorTraceTable(data) {
  const summary = data.summary || {};
  renderKeyValueRows('Mirror Trace', [
    ['marketAddress', data.selector && data.selector.pandoraMarketAddress ? data.selector.pandoraMarketAddress : ''],
    ['rpcUrl', summary.rpcUrl || (data.selector && data.selector.rpcUrl) || ''],
    ['snapshotCount', summary.snapshotCount || 0],
    ['blockSpan', summary.blockSpan || ''],
    ['fallbackRpcCount', summary.fallbackRpcCount || 0],
    ['archiveRequired', formatArchiveRequirement(summary)],
  ]);

  if (Array.isArray(data.snapshots) && data.snapshots.length) {
    console.table(
      data.snapshots.slice(0, 20).map((snapshot) => ({
        blockNumber: snapshot.blockNumber,
        blockTimestamp: snapshot.blockTimestamp || '',
        reserveYesUsdc: snapshot.reserveYesUsdc,
        reserveNoUsdc: snapshot.reserveNoUsdc,
        pandoraYesPct: snapshot.pandoraYesPct,
        feeTier: snapshot.feeTier,
        rpcUrl: snapshot.rpcUrl || '',
        reserveSource: snapshot.source || '',
      })),
    );
  }
}

module.exports = async function handleMirrorTrace({ actionArgs, shared, context, deps }) {
  const {
    includesHelpFlag,
    emitSuccess,
    commandHelpPayload,
    parseMirrorTraceFlags,
    traceMirrorReserves,
    coerceMirrorServiceError,
  } = deps;

  const usage =
    'pandora [--output table|json] mirror trace --pandora-market-address <address>|--market-address <address> --rpc-url <url> [--blocks <csv> | --from-block <n> --to-block <n> [--step <n>]] [--limit <n>]';

  if (includesHelpFlag(actionArgs)) {
    if (context.outputMode === 'json') {
      emitSuccess(
        context.outputMode,
        'mirror.trace.help',
        commandHelpPayload(usage, [
          'mirror trace is a read-only historical reserve tracing surface for Pandora pool forensics and replay-grade analysis.',
          'Use --blocks for explicit historical samples or --from-block/--to-block with --step for range sampling.',
          'Deep history requires an archive-capable RPC; non-archive endpoints can fail once the requested state ages out.',
          'Trace requests cap at 1000 snapshots; narrow the block range, increase --step, or pass --limit to keep large postmortems bounded.',
        ]),
      );
    } else {
      console.log(`Usage: ${usage}`);
      console.log('mirror trace is a read-only historical reserve tracing surface for Pandora pool forensics and replay-grade analysis.');
      console.log('Use --blocks for explicit historical samples or --from-block/--to-block with --step for range sampling.');
      console.log('Deep history requires an archive-capable RPC; non-archive endpoints can fail once the requested state ages out.');
      console.log('Trace requests cap at 1000 snapshots; narrow the block range, increase --step, or pass --limit to keep large postmortems bounded.');
    }
    return;
  }

  const options = parseMirrorTraceFlags(actionArgs);
  if (shared && Number.isFinite(Number(shared.timeoutMs)) && Number(shared.timeoutMs) > 0) {
    options.timeoutMs = Number(shared.timeoutMs);
  }

  try {
    const payload = await traceMirrorReserves(options);
    emitSuccess(context.outputMode, 'mirror.trace', payload, renderMirrorTraceTable);
  } catch (err) {
    if (typeof coerceMirrorServiceError === 'function') {
      throw coerceMirrorServiceError(err, 'MIRROR_TRACE_FAILED');
    }
    throw err;
  }
};
