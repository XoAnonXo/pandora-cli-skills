export type MarketSide = "home" | "draw" | "away"

export type MarketMakerFixture = {
  id: string
  feedId: string
  stage: string
  homeTeam: string
  awayTeam: string
  kickoffUtc: string
  venue: string
  marketSide: MarketSide
  pandoraOdds: number
  polymarketOdds: number
  liquidityCapUsdc: number
  hedgeGapUsdc: number
  spreadBps: number
  status: "ready" | "needs-poly" | "needs-odds" | "paper-running"
  daemonStatus: "not-started" | "paper-running" | "blocked"
  polymarketSlug: string | null
  readiness: {
    fixture: boolean
    odds: boolean
    polymarket: boolean
    risk: boolean
    signer: boolean
    internalWallets: boolean
  }
}

export type LaunchPacket = {
  endpoint: string
  mode: "paper"
  fixtureId: string
  marketSide: MarketSide
  liquidityCapUsdc: number
  commands: string[]
}

export const privateRunnerEndpoint = "/api/private/market-maker/launch"

export const marketMakerSummary = [
  {
    label: "Football games",
    value: "64 feed slots",
    detail: "Table is built for the full fixture feed.",
  },
  {
    label: "Launch mode",
    value: "Paper only",
    detail: "Live create stays behind the private runner.",
  },
  {
    label: "Hedge venue",
    value: "Polymarket",
    detail: "Daemon tracks Pandora exposure and hedges deltas.",
  },
  {
    label: "Action endpoint",
    value: "Private API",
    detail: "No signer secrets are shipped in the browser.",
  },
] as const

export const marketMakerFixtures = [
  {
    id: "wc-2026-feed-001",
    feedId: "FIFA-FEED-001",
    stage: "Group feed",
    homeTeam: "Feed home 001",
    awayTeam: "Feed away 001",
    kickoffUtc: "2026-06-11T19:00:00Z",
    venue: "Fixture feed venue",
    marketSide: "home",
    pandoraOdds: 0.54,
    polymarketOdds: 0.51,
    liquidityCapUsdc: 2500,
    hedgeGapUsdc: 75,
    spreadBps: 300,
    status: "ready",
    daemonStatus: "not-started",
    polymarketSlug: "world-cup-feed-001-home",
    readiness: {
      fixture: true,
      odds: true,
      polymarket: true,
      risk: true,
      signer: false,
      internalWallets: true,
    },
  },
  {
    id: "wc-2026-feed-002",
    feedId: "FIFA-FEED-002",
    stage: "Group feed",
    homeTeam: "Feed home 002",
    awayTeam: "Feed away 002",
    kickoffUtc: "2026-06-12T01:00:00Z",
    venue: "Fixture feed venue",
    marketSide: "away",
    pandoraOdds: 0.42,
    polymarketOdds: 0.39,
    liquidityCapUsdc: 1800,
    hedgeGapUsdc: 54,
    spreadBps: 300,
    status: "ready",
    daemonStatus: "not-started",
    polymarketSlug: "world-cup-feed-002-away",
    readiness: {
      fixture: true,
      odds: true,
      polymarket: true,
      risk: true,
      signer: false,
      internalWallets: true,
    },
  },
  {
    id: "wc-2026-feed-003",
    feedId: "FIFA-FEED-003",
    stage: "Group feed",
    homeTeam: "Feed home 003",
    awayTeam: "Feed away 003",
    kickoffUtc: "2026-06-12T22:00:00Z",
    venue: "Fixture feed venue",
    marketSide: "draw",
    pandoraOdds: 0.27,
    polymarketOdds: 0.24,
    liquidityCapUsdc: 1200,
    hedgeGapUsdc: 36,
    spreadBps: 300,
    status: "ready",
    daemonStatus: "not-started",
    polymarketSlug: "world-cup-feed-003-draw",
    readiness: {
      fixture: true,
      odds: true,
      polymarket: true,
      risk: true,
      signer: false,
      internalWallets: true,
    },
  },
  {
    id: "wc-2026-feed-004",
    feedId: "FIFA-FEED-004",
    stage: "Group feed",
    homeTeam: "Feed home 004",
    awayTeam: "Feed away 004",
    kickoffUtc: "2026-06-13T19:00:00Z",
    venue: "Fixture feed venue",
    marketSide: "home",
    pandoraOdds: 0.61,
    polymarketOdds: 0.58,
    liquidityCapUsdc: 3200,
    hedgeGapUsdc: 96,
    spreadBps: 300,
    status: "needs-poly",
    daemonStatus: "blocked",
    polymarketSlug: null,
    readiness: {
      fixture: true,
      odds: true,
      polymarket: false,
      risk: true,
      signer: false,
      internalWallets: true,
    },
  },
  {
    id: "wc-2026-feed-005",
    feedId: "FIFA-FEED-005",
    stage: "Group feed",
    homeTeam: "Feed home 005",
    awayTeam: "Feed away 005",
    kickoffUtc: "2026-06-14T01:00:00Z",
    venue: "Fixture feed venue",
    marketSide: "away",
    pandoraOdds: 0.36,
    polymarketOdds: 0.37,
    liquidityCapUsdc: 1500,
    hedgeGapUsdc: 15,
    spreadBps: -100,
    status: "needs-odds",
    daemonStatus: "blocked",
    polymarketSlug: "world-cup-feed-005-away",
    readiness: {
      fixture: true,
      odds: false,
      polymarket: true,
      risk: true,
      signer: false,
      internalWallets: true,
    },
  },
  {
    id: "wc-2026-feed-006",
    feedId: "FIFA-FEED-006",
    stage: "Group feed",
    homeTeam: "Feed home 006",
    awayTeam: "Feed away 006",
    kickoffUtc: "2026-06-14T22:00:00Z",
    venue: "Fixture feed venue",
    marketSide: "home",
    pandoraOdds: 0.49,
    polymarketOdds: 0.46,
    liquidityCapUsdc: 2200,
    hedgeGapUsdc: 66,
    spreadBps: 300,
    status: "paper-running",
    daemonStatus: "paper-running",
    polymarketSlug: "world-cup-feed-006-home",
    readiness: {
      fixture: true,
      odds: true,
      polymarket: true,
      risk: true,
      signer: false,
      internalWallets: true,
    },
  },
] as const satisfies readonly MarketMakerFixture[]

export const riskGates = [
  "Fresh fixture, kickoff time, and provider status are present.",
  "Pandora odds come from sports consensus or approved model input.",
  "Polymarket odds resolve by market id or slug before daemon start.",
  "Liquidity cap is explicit per fixture.",
  "Internal wallet allowlist is present before hedge math.",
  "Live signer profile is absent in paper mode and required for live mode.",
] as const

export const dataFeeds = [
  "sports schedule for fixtures and kickoff time",
  "sports odds snapshot or consensus for Pandora opening probability",
  "Polymarket Gamma/CLOB feed for hedge venue odds",
  "mirror hedge daemon status for runtime health",
] as const

export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

export function formatMoney(value: number) {
  return `$${value.toLocaleString("en-US")}`
}

export function formatKickoff(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso))
}

export function getReadinessScore(fixture: MarketMakerFixture) {
  return Object.values(fixture.readiness).filter(Boolean).length
}

export function canLaunchPaper(fixture: MarketMakerFixture) {
  return (
    fixture.readiness.fixture
    && fixture.readiness.odds
    && fixture.readiness.polymarket
    && fixture.readiness.risk
    && fixture.readiness.internalWallets
  )
}

export function buildLaunchPacket(fixture: MarketMakerFixture): LaunchPacket {
  const side = fixture.marketSide
  const stateFile = `./state/world-cup/${fixture.id}.json`
  const slug = fixture.polymarketSlug || "<polymarket-slug>"

  return {
    endpoint: privateRunnerEndpoint,
    mode: "paper",
    fixtureId: fixture.id,
    marketSide: side,
    liquidityCapUsdc: fixture.liquidityCapUsdc,
    commands: [
      `npx pandora --output json sports create plan \\
  --event-id ${fixture.id} \\
  --selection ${side} \\
  --market-type amm \\
  --sources https://primary-source.example/${fixture.id} \\
  --sources https://backup-source.example/${fixture.id}`,
      `npx pandora --output json sports create run \\
  --event-id ${fixture.id} \\
  --selection ${side} \\
  --market-type amm \\
  --dry-run \\
  --liquidity-usdc ${fixture.liquidityCapUsdc} \\
  --sources https://primary-source.example/${fixture.id} \\
  --sources https://backup-source.example/${fixture.id} \\
  --profile-id paper-market-maker`,
      `npx pandora --output json mirror hedge start \\
  --state-file ${stateFile} \\
  --pandora-market-address <created-pandora-market> \\
  --polymarket-slug ${slug} \\
  --internal-wallets-file ./config/internal-wallets.txt \\
  --paper \\
  --min-hedge-usdc 25 \\
  --partial-hedge-policy partial \\
  --sell-hedge-policy depth-checked`,
      `npx pandora --output json mirror hedge status \\
  --strategy-hash <daemon-strategy-hash>`,
      `npx pandora --output json mirror hedge stop \\
  --strategy-hash <daemon-strategy-hash>`,
    ],
  }
}
