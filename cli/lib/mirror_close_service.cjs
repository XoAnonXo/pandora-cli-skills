const MIRROR_CLOSE_SCHEMA_VERSION = '1.0.0';

function buildMirrorClosePlan(options = {}) {
  const mode = options.execute ? 'execute' : 'dry-run';
  const steps = [
    {
      key: 'pandora-withdraw-lp',
      description: 'Withdraw LP position from Pandora AMM.',
      status: mode === 'execute' ? 'pending' : 'planned',
    },
    {
      key: 'polymarket-unwind-hedge',
      description: 'Close hedge position on Polymarket.',
      status: mode === 'execute' ? 'pending' : 'planned',
    },
    {
      key: 'finalize-report',
      description: 'Compute final mirror unwind report and PnL approximation.',
      status: mode === 'execute' ? 'pending' : 'planned',
    },
  ];

  return {
    schemaVersion: MIRROR_CLOSE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode,
    pandoraMarketAddress: options.pandoraMarketAddress || null,
    polymarketMarketId: options.polymarketMarketId || null,
    polymarketSlug: options.polymarketSlug || null,
    steps,
    diagnostics: [
      mode === 'execute'
        ? 'Execution path is scaffolded and currently gated.'
        : 'Dry-run close plan generated.',
    ],
  };
}

module.exports = {
  MIRROR_CLOSE_SCHEMA_VERSION,
  buildMirrorClosePlan,
};
