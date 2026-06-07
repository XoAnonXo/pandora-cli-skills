import { useState } from "react"
import {
  Activity,
  ArrowLeft,
  Check,
  Copy,
  Goal,
  Rocket,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  buildLaunchPacket,
  canLaunchPaper,
  dataFeeds,
  formatKickoff,
  formatMoney,
  formatPercent,
  getReadinessScore,
  marketMakerFixtures,
  marketMakerSummary,
  privateRunnerEndpoint,
  riskGates,
  type LaunchPacket,
  type MarketMakerFixture,
} from "@/market-maker-data"

type LaunchState = "idle" | "submitting" | "accepted" | "staged"

const statusCopy = {
  ready: "Ready",
  "needs-poly": "Needs Poly",
  "needs-odds": "Needs odds",
  "paper-running": "Paper running",
} as const

const daemonCopy = {
  "not-started": "Not started",
  "paper-running": "Paper running",
  blocked: "Blocked",
} as const

function MarketMakerPage() {
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>(
    marketMakerFixtures[0].id
  )
  const [launchState, setLaunchState] = useState<LaunchState>("idle")
  const [receipt, setReceipt] = useState<string | null>(null)
  const selectedFixture =
    marketMakerFixtures.find((fixture) => fixture.id === selectedFixtureId)
    ?? marketMakerFixtures[0]
  const launchPacket = buildLaunchPacket(selectedFixture)
  const launchReady = canLaunchPaper(selectedFixture)

  async function handleLaunch() {
    const requestBody = {
      mode: launchPacket.mode,
      fixtureId: selectedFixture.id,
      marketSide: selectedFixture.marketSide,
      liquidityCapUsdc: selectedFixture.liquidityCapUsdc,
      polymarketSlug: selectedFixture.polymarketSlug,
      commands: launchPacket.commands,
    }

    setLaunchState("submitting")
    setReceipt("Submitting launch request to private runner...")

    try {
      const response = await fetch(privateRunnerEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        throw new Error(`runner returned HTTP ${response.status}`)
      }

      const contentType = response.headers.get("content-type") || ""
      if (!contentType.includes("application/json")) {
        throw new Error("runner response was not JSON")
      }

      setLaunchState("accepted")
      setReceipt("Private runner accepted the paper launch request.")
    } catch {
      setLaunchState("staged")
      setReceipt(
        "Static preview staged the packet. Wire the private runner endpoint to execute it."
      )
    }
  }

  return (
    <div className="private-market-page min-h-screen bg-[#070a0d] text-white">
      <div className="private-market-orb" aria-hidden="true" />
      <header className="border-b border-white/10 bg-[#070a0d]/86 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-4 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <a
              href="./#top"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-10 rounded-full border-white/10 bg-white/[0.04] px-4 text-white hover:bg-white/[0.08] hover:text-white"
              )}
            >
              <ArrowLeft className="size-4" />
              Public site
            </a>
            <Badge className="rounded-full bg-[#8dffb0]/12 px-3 text-[12px] font-medium tracking-[0.1em] text-[#8dffb0] ring-1 ring-[#8dffb0]/18">
              Private operator UI
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium tracking-[0.1em] text-white/48 uppercase">
            <span>POST {privateRunnerEndpoint}</span>
            <span className="h-1 w-1 rounded-full bg-white/30" />
            <span>Paper mode default</span>
            <span className="h-1 w-1 rounded-full bg-white/30" />
            <span>No browser secrets</span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[92rem] gap-5 px-5 py-6 sm:px-6 lg:px-8">
        <section className="private-market-hero overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_32px_120px_rgba(0,0,0,0.36)] sm:p-7">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:items-end">
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <Badge className="rounded-full bg-[#ffcf5a]/12 px-3 text-[12px] font-medium tracking-[0.1em] text-[#ffdf89] ring-1 ring-[#ffdf89]/18">
                  World Cup desk
                </Badge>
                <Badge className="rounded-full bg-white/[0.06] px-3 text-[12px] font-medium tracking-[0.1em] text-white/58 ring-1 ring-white/10">
                  Football fixtures
                </Badge>
              </div>
              <div>
                <h1 className="max-w-[12ch] text-[clamp(2.5rem,5vw,5.6rem)] leading-[0.88] font-semibold tracking-[-0.09em] text-white">
                  Private football market maker.
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-white/62">
                  One operator view for all games: start time, Pandora odds,
                  Polymarket odds, liquidity cap, launch readiness, and hedge
                  daemon lifecycle.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {marketMakerSummary.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4"
                >
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-white/42 uppercase">
                    {item.label}
                  </p>
                  <p className="mt-2 text-[1.45rem] font-semibold tracking-[-0.05em]">
                    {item.value}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-white/52">
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {dataFeeds.map((feed) => (
            <div
              key={feed}
              className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4 text-sm leading-6 text-white/58"
            >
              <p className="text-[11px] font-semibold tracking-[0.14em] text-[#8dffb0] uppercase">
                Source
              </p>
              <p className="mt-2">{feed}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.38fr)_minmax(26rem,0.62fr)]">
          <Card className="rounded-[30px] border border-white/10 bg-[#0d1217]/94 py-0 text-white shadow-[0_24px_80px_rgba(0,0,0,0.26)]">
            <CardHeader className="border-b border-white/10 px-5 py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardDescription className="text-[12px] font-semibold tracking-[0.14em] text-[#8dffb0] uppercase">
                    All football games
                  </CardDescription>
                  <CardTitle className="mt-2 text-[1.55rem] tracking-[-0.05em] text-white">
                    Fixture board
                  </CardTitle>
                </div>
                <Badge className="rounded-full bg-white/[0.06] px-3 py-1 text-white/58 ring-1 ring-white/10">
                  {marketMakerFixtures.length} visible feed rows
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[62rem] text-left text-sm">
                  <thead className="border-b border-white/10 bg-white/[0.03] text-[11px] font-semibold tracking-[0.13em] text-white/40 uppercase">
                    <tr>
                      <th className="px-5 py-3">Game</th>
                      <th className="px-4 py-3">Start</th>
                      <th className="px-4 py-3">Pandora odds</th>
                      <th className="px-4 py-3">Poly odds</th>
                      <th className="px-4 py-3">Edge</th>
                      <th className="px-4 py-3">Liquidity</th>
                      <th className="px-4 py-3">State</th>
                      <th className="px-5 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketMakerFixtures.map((fixture) => (
                      <FixtureRow
                        key={fixture.id}
                        fixture={fixture}
                        selected={fixture.id === selectedFixture.id}
                        onSelect={() => {
                          setSelectedFixtureId(fixture.id)
                          setLaunchState("idle")
                          setReceipt(null)
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <ActionPanel
            fixture={selectedFixture}
            launchPacket={launchPacket}
            launchReady={launchReady}
            launchState={launchState}
            receipt={receipt}
            onLaunch={handleLaunch}
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <DeskPanel
            icon={Goal}
            title="Strategy state"
            subtitle="What should happen"
            items={[
              `Launch ${selectedFixture.marketSide.toUpperCase()} market for ${selectedFixture.homeTeam} vs ${selectedFixture.awayTeam}.`,
              `Open Pandora at ${formatPercent(selectedFixture.pandoraOdds)} and compare against Poly ${formatPercent(selectedFixture.polymarketOdds)}.`,
              `Cap initial liquidity at ${formatMoney(selectedFixture.liquidityCapUsdc)} before any live upgrade.`,
            ]}
          />
          <DeskPanel
            icon={ServerCog}
            title="Process state"
            subtitle="Is the daemon running"
            items={[
              `Daemon: ${daemonCopy[selectedFixture.daemonStatus]}.`,
              "Bundle first if this needs a VPS handoff.",
              "Status and stop must use strategy hash or PID file from the runner receipt.",
            ]}
          />
          <DeskPanel
            icon={ShieldAlert}
            title="Risk blockers"
            subtitle="Why it can or cannot trade"
            items={riskGates.map((gate) =>
              gate.replace("Live signer profile", "Live signer profile")
            )}
          />
        </section>
      </main>
    </div>
  )
}

function FixtureRow({
  fixture,
  selected,
  onSelect,
}: {
  fixture: MarketMakerFixture
  selected: boolean
  onSelect: () => void
}) {
  const ready = canLaunchPaper(fixture)
  const edgePositive = fixture.spreadBps >= 0

  return (
    <tr
      className={cn(
        "border-b border-white/8 transition-colors hover:bg-white/[0.04]",
        selected ? "bg-[#8dffb0]/8" : "bg-transparent"
      )}
    >
      <td className="px-5 py-4">
        <div>
          <p className="font-medium tracking-[-0.02em] text-white">
            {fixture.homeTeam} vs {fixture.awayTeam}
          </p>
          <p className="mt-1 text-[12px] text-white/42">
            {fixture.feedId} - {fixture.stage} - {fixture.venue}
          </p>
        </div>
      </td>
      <td className="px-4 py-4 text-white/66">{formatKickoff(fixture.kickoffUtc)}</td>
      <td className="px-4 py-4">
        <OddsPill value={fixture.pandoraOdds} label={fixture.marketSide} />
      </td>
      <td className="px-4 py-4">
        <OddsPill value={fixture.polymarketOdds} label="poly" />
      </td>
      <td className="px-4 py-4">
        <span
          className={cn(
            "rounded-full px-3 py-1 text-[12px] font-semibold",
            edgePositive
              ? "bg-[#8dffb0]/12 text-[#8dffb0]"
              : "bg-[#ff7a7a]/12 text-[#ff9b9b]"
          )}
        >
          {edgePositive ? "+" : ""}
          {fixture.spreadBps} bps
        </span>
      </td>
      <td className="px-4 py-4 text-white/70">{formatMoney(fixture.liquidityCapUsdc)}</td>
      <td className="px-4 py-4">
        <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[12px] text-white/62">
          {statusCopy[fixture.status]}
        </span>
      </td>
      <td className="px-5 py-4 text-right">
        <Button
          type="button"
          size="sm"
          variant={selected ? "secondary" : "outline"}
          className={cn(
            "h-9 rounded-full px-4",
            selected
              ? "bg-[#8dffb0] text-[#07130c] hover:bg-[#a8ffc2]"
              : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08] hover:text-white"
          )}
          onClick={onSelect}
        >
          {ready ? "Select" : "Inspect"}
        </Button>
      </td>
    </tr>
  )
}

function ActionPanel({
  fixture,
  launchPacket,
  launchReady,
  launchState,
  receipt,
  onLaunch,
}: {
  fixture: MarketMakerFixture
  launchPacket: LaunchPacket
  launchReady: boolean
  launchState: LaunchState
  receipt: string | null
  onLaunch: () => void
}) {
  const blockers = Object.entries(fixture.readiness)
    .filter(([, ready]) => !ready)
    .map(([key]) => key)
  const commandText = launchPacket.commands.join("\n\n")
  const launchLabel =
    launchState === "submitting"
      ? "Submitting..."
      : launchState === "accepted"
        ? "Runner accepted"
        : launchState === "staged"
          ? "Packet staged"
          : "Launch market + daemon"

  return (
    <Card className="rounded-[30px] border border-white/10 bg-[#111821]/94 py-0 text-white shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
      <CardHeader className="border-b border-white/10 px-5 py-5">
        <CardDescription className="text-[12px] font-semibold tracking-[0.14em] text-[#ffdf89] uppercase">
          Operator action
        </CardDescription>
        <CardTitle className="mt-2 text-[1.45rem] tracking-[-0.05em] text-white">
          {fixture.homeTeam} vs {fixture.awayTeam}
        </CardTitle>
        <CardDescription className="text-sm leading-6 text-white/54">
          Create the Pandora AMM market, then start Polymarket Hedge Mode
          for the selected side.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <MetricTile label="Readiness" value={`${getReadinessScore(fixture)}/6`} />
          <MetricTile label="Hedge gap" value={formatMoney(fixture.hedgeGapUsdc)} />
          <MetricTile label="Market side" value={fixture.marketSide.toUpperCase()} />
          <MetricTile label="Endpoint" value="private runner" />
        </div>

        <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-[#8dffb0]/12 text-[#8dffb0] ring-1 ring-[#8dffb0]/18">
              {launchReady ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
            </span>
            <div>
              <p className="text-sm font-medium text-white">
                {launchReady ? "Paper launch ready." : "Launch blocked."}
              </p>
              <p className="mt-1 text-sm leading-6 text-white/56">
                {launchReady
                  ? `Ready to POST a paper launch request to ${launchPacket.endpoint}.`
                  : `Missing: ${blockers.join(", ")}.`}
              </p>
            </div>
          </div>
        </div>

        <Button
          type="button"
          className="h-12 w-full rounded-full bg-[#8dffb0] px-5 text-[#07130c] shadow-[0_18px_48px_rgba(141,255,176,0.14)] hover:bg-[#a8ffc2]"
          disabled={!launchReady || launchState === "submitting"}
          onClick={onLaunch}
        >
          <Rocket className="size-4" />
          {launchLabel}
        </Button>

        {receipt ? (
          <div className="rounded-[20px] border border-[#8dffb0]/18 bg-[#8dffb0]/8 px-4 py-3 text-sm leading-6 text-[#c8ffd7]">
            {receipt}
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-semibold tracking-[0.14em] text-white/42 uppercase">
              Launch packet
            </p>
            <CopyButton value={commandText} />
          </div>
          <pre className="max-h-[23rem] overflow-auto rounded-[22px] border border-white/10 bg-[#070a0d] px-4 py-4 text-[12px] leading-6 text-white/72">
            <code>{commandText}</code>
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}

function OddsPill({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-[12px] font-semibold text-white/76 ring-1 ring-white/10">
      <span className="h-1.5 w-1.5 rounded-full bg-[#8dffb0]" />
      {formatPercent(value)}
      <span className="text-white/34">{label}</span>
    </span>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.045] px-4 py-3">
      <p className="text-[11px] font-semibold tracking-[0.13em] text-white/38 uppercase">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold tracking-[-0.04em] text-white">
        {value}
      </p>
    </div>
  )
}

function DeskPanel({
  icon: Icon,
  title,
  subtitle,
  items,
}: {
  icon: typeof Activity
  title: string
  subtitle: string
  items: readonly string[]
}) {
  return (
    <Card className="rounded-[28px] border border-white/10 bg-white/[0.045] py-0 text-white">
      <CardHeader className="px-5 py-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-[18px] bg-[#8dffb0]/12 text-[#8dffb0] ring-1 ring-[#8dffb0]/18">
            <Icon className="size-5" />
          </span>
          <div>
            <CardTitle className="text-lg tracking-[-0.04em] text-white">
              {title}
            </CardTitle>
            <CardDescription className="text-sm text-white/48">
              {subtitle}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-5 pb-5">
        {items.map((item) => (
          <div
            key={item}
            className="flex gap-3 rounded-[18px] border border-white/8 bg-black/16 px-3 py-3 text-sm leading-6 text-white/58"
          >
            <Check className="mt-1 size-4 shrink-0 text-[#8dffb0]" />
            {item}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 text-[12px] font-medium text-white/62 transition hover:bg-white/[0.08] hover:text-white"
      onClick={handleCopy}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

export default MarketMakerPage
