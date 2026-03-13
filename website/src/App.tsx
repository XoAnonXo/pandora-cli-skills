import { useState } from "react"
import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Menu,
  MoonStar,
  SunMedium,
  TerminalSquare,
} from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { navLinks, proofLinks, quickStarts, workflows } from "@/site-data"

const audienceMeta = {
  agent: {
    anchor: "agents",
    icon: Bot,
    labels: ["MCP", "Skills guidance"],
  },
  builder: {
    anchor: "builders",
    icon: Code2,
    labels: ["SDK", "Generated contracts"],
  },
  operator: {
    anchor: "operators",
    icon: TerminalSquare,
    labels: ["CLI", "Stable JSON"],
  },
} as const

const exampleWorkflow = workflows[0]
const headerLogoSrc = `${import.meta.env.BASE_URL}pandora-logo.svg`

const examplePanels = [
  {
    id: "agent",
    label: "Agents",
    shell: "mcp",
    caption: "Agent hosts call Pandora as tools through MCP.",
    code: exampleWorkflow.panels.mcp.code,
  },
  {
    id: "builder",
    label: "Builders",
    shell: "typescript",
    caption: "Product code can drive the same workflow through the SDK.",
    code: exampleWorkflow.panels.sdk.code,
  },
  {
    id: "operator",
    label: "Operators",
    shell: "cli",
    caption: "Operators can own the same flow directly from the terminal.",
    code: exampleWorkflow.panels.cli.code,
  },
] as const

function App() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="site-shell">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[var(--brand-blue)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>

      <div className="site-noise" aria-hidden="true" />

      <header className="sticky top-0 z-40 border-b border-black/6 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex items-center gap-3 text-sm font-medium">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-[#0f1115] shadow-[0_8px_30px_rgba(10,15,30,0.12)] ring-1 ring-black/8 dark:ring-white/10">
              <img
                src={headerLogoSrc}
                alt=""
                aria-hidden="true"
                className="size-9"
              />
            </span>
            <span className="text-[1.02rem] tracking-[-0.02em]">Pandora</span>
          </a>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground lg:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a
              href="https://github.com/XoAnonXo/pandora-cli-skills"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "hidden h-11 rounded-full border-black/10 bg-white/70 px-4 text-foreground shadow-[0_10px_30px_rgba(15,23,42,0.05)] lg:inline-flex dark:border-white/10 dark:bg-white/5"
              )}
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>

            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="size-11 rounded-full border-black/10 bg-white/70 shadow-[0_10px_30px_rgba(15,23,42,0.05)] lg:hidden dark:border-white/10 dark:bg-white/5"
                    aria-label="Open navigation"
                  />
                }
              >
                <Menu />
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-[88vw] max-w-sm border-l border-black/8 bg-[#fbfbfc]/96 px-1 pt-6 dark:border-white/10 dark:bg-[#0c0d10]/96"
              >
                <SheetHeader className="space-y-2">
                  <SheetTitle>Navigate Pandora</SheetTitle>
                  <SheetDescription>
                    Minimal structure, deep content behind clear entry points.
                  </SheetDescription>
                </SheetHeader>
                <div className="space-y-2 px-4 pb-6">
                  {navLinks.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      className="flex items-center justify-between rounded-2xl border border-black/6 bg-white/80 px-4 py-3 text-sm font-medium text-foreground transition-transform hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/5"
                      onClick={() => setMobileNavOpen(false)}
                    >
                      {link.label}
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main id="main" className="relative" role="main">
        <section id="top" className="px-5 pb-10 pt-8 sm:px-6 lg:px-8 lg:pb-14 lg:pt-10">
          <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)] lg:items-start lg:gap-10 xl:gap-12">
            <div className="space-y-6 lg:pr-6">
              <Badge className="w-fit rounded-full bg-[color:rgba(0,113,227,0.12)] px-3 text-[12px] font-medium tracking-[0.08em] text-[var(--brand-blue)]">
                Pandora runtime
              </Badge>

              <div className="max-w-3xl space-y-5">
                <p className="max-w-xl text-[12px] font-semibold tracking-[0.14em] text-[var(--brand-blue)] uppercase">
                  MCP for agents. SDK for builders. CLI for operators.
                </p>
                <h1 className="max-w-[12ch] text-balance text-[clamp(2.6rem,4.5vw,4.2rem)] leading-[0.97] font-semibold tracking-[-0.075em] text-foreground">
                  Pandora for agents, builders, and operators.
                </h1>
                <p className="max-w-[34rem] text-[0.98rem] leading-7 text-foreground/76 sm:text-[1.04rem]">
                  Use the same runtime through MCP, the SDK, or the CLI.
                  Skills are guidance, not another execution surface.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <a
                  href="#agents"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "h-11 rounded-full bg-primary px-5 text-primary-foreground shadow-[0_18px_60px_rgba(17,24,39,0.18)] hover:bg-primary/92"
                  )}
                >
                  Agent path
                </a>
                <a
                  href="#builders"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "h-11 rounded-full border-black/10 bg-white/70 px-5 text-foreground shadow-[0_14px_40px_rgba(15,23,42,0.06)] hover:bg-white dark:border-white/10 dark:bg-white/5"
                  )}
                >
                  Builder path
                </a>
                <a
                  href="#operators"
                  className="inline-flex h-11 items-center gap-2 rounded-full px-1 text-sm font-medium text-[var(--brand-blue)]"
                >
                  Operator path
                  <ArrowRight className="size-4" />
                </a>
              </div>
            </div>

            <div className="min-w-0 lg:pt-2">
              <Card className="mx-auto w-full min-w-0 max-w-[40rem] overflow-hidden rounded-[26px] border border-black/6 bg-[#0f1115] py-0 text-white shadow-[0_24px_80px_rgba(9,15,24,0.22)] dark:border-white/10 lg:ml-auto xl:max-w-[41rem]">
                <CardHeader className="px-6 py-5">
                  <CardDescription className="text-[12px] font-medium tracking-[0.08em] text-white/60">
                    Quick paths
                  </CardDescription>
                  <CardTitle className="text-[1.65rem] tracking-[-0.05em]">
                    Choose your role.
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-6 pb-6">
                  <div className="grid gap-3">
                    {quickStarts.map((route) => (
                      <div key={route.id} className="min-w-0 overflow-hidden rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.04] text-[var(--brand-blue)]">
                              {route.id === "agent" ? (
                                <Bot className="size-5" />
                              ) : route.id === "builder" ? (
                                <Code2 className="size-5" />
                              ) : (
                                <TerminalSquare className="size-5" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-medium tracking-[0.08em] text-[var(--brand-blue)]">
                                {route.audience}
                              </p>
                              <h3 className="text-base font-medium tracking-[-0.03em] text-white">
                                {route.title}
                              </h3>
                              <p className="mt-2 max-w-[28rem] text-sm leading-6 text-white/68">
                                {route.summary}
                              </p>
                            </div>
                          </div>
                          <a href={`#${audienceMeta[route.id].anchor}`} className="inline-flex shrink-0 items-center gap-2 self-center text-sm font-medium text-white/92">
                            Open
                            <ArrowRight className="size-4" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm leading-6 text-white/62">
                    One runtime underneath. Skills guide the safe path.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <SectionFrame
          id="audiences"
          eyebrow="Paths"
          title="Three clear paths."
          description="Pick the section that matches who owns the workflow."
        >
          <div className="grid gap-4 xl:grid-cols-3">
            {quickStarts.map((route) => {
              const meta = audienceMeta[route.id]
              const Icon = meta.icon
              return (
                <Card
                  key={route.id}
                  id={meta.anchor}
                  className="scroll-mt-28 rounded-[24px] border border-black/6 bg-white/78 py-0 shadow-[0_18px_60px_rgba(12,18,28,0.06)] backdrop-blur-xl dark:border-white/10 dark:bg-white/6"
                >
                  <CardHeader className="space-y-4 px-6 py-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Badge className="w-fit rounded-full bg-[color:rgba(0,113,227,0.1)] px-3 text-[12px] font-medium tracking-[0.08em] text-[var(--brand-blue)]">
                        {route.audience}
                      </Badge>
                      <div className="flex flex-wrap gap-2">
                        {meta.labels.map((label) => (
                          <span
                            key={label}
                            className="rounded-full border border-black/8 bg-white px-3 py-1 text-[11px] font-medium tracking-[0.08em] text-foreground/70 dark:border-white/10 dark:bg-white/5 dark:text-white/72"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <CardTitle className="mt-4 flex items-center gap-3 text-[1.35rem] tracking-[-0.04em]">
                      <span className="flex size-10 items-center justify-center rounded-[18px] border border-black/6 bg-[#f5f7fb] text-[var(--brand-blue)] dark:border-white/10 dark:bg-white/6">
                        <Icon className="size-5" />
                      </span>
                      {route.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 px-6 pb-6">
                    <p className="text-sm leading-6 text-muted-foreground">
                      {route.summary}
                    </p>
                    <CodeBlock code={route.code} />
                    <a
                      href={route.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-sm font-medium text-[var(--brand-blue)]"
                    >
                      {route.linkLabel}
                      <ArrowRight className="size-4" />
                    </a>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              ["CLI", "Direct command control."],
              ["MCP", "Tool transport for agent hosts."],
              ["SDK", "Versioned clients for products."],
              ["Skills", "Guidance layered over the other three."],
            ].map(([label, text]) => (
              <div
                key={label}
                className="rounded-[22px] border border-black/6 bg-white/72 px-4 py-4 text-sm leading-6 text-foreground/74 shadow-[0_12px_36px_rgba(12,18,28,0.05)] dark:border-white/10 dark:bg-white/6"
              >
                <p className="text-[12px] font-medium tracking-[0.08em] text-[var(--brand-blue)]">
                  {label}
                </p>
                <p className="mt-2">{text}</p>
              </div>
            ))}
          </div>
        </SectionFrame>

        <SectionFrame
          id="workflow"
          eyebrow="Example"
          title="One workflow, three interfaces."
          description="Mirror a market with the same plan whether the run belongs to an agent, a product team, or an operator."
        >
          <div className="grid gap-5 xl:grid-cols-[0.78fr_1.22fr]">
            <Card className="rounded-[24px] border border-black/6 bg-white/78 py-0 shadow-[0_18px_60px_rgba(12,18,28,0.06)] backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
              <CardHeader className="space-y-4 px-6 py-6">
                <CardDescription className="text-[12px] font-medium tracking-[0.08em] text-[var(--brand-blue)]">
                  {exampleWorkflow.label}
                </CardDescription>
                <CardTitle className="text-[clamp(1.45rem,1.9vw,1.95rem)] tracking-[-0.05em]">
                  {exampleWorkflow.title}
                </CardTitle>
                <CardDescription className="max-w-xl text-sm leading-6 text-muted-foreground">
                  Research first, validate the plan, then execute with the
                  right trust posture.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 px-6 pb-6">
                <div className="flex flex-wrap gap-2">
                  {exampleWorkflow.steps.map((step, index) => (
                    <div
                      key={step}
                      className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-3 py-2 text-[12px] font-medium text-foreground/76 dark:border-white/10 dark:bg-white/6 dark:text-white/78"
                    >
                      <span className="flex size-5 items-center justify-center rounded-full bg-[rgba(0,113,227,0.1)] text-[11px] text-[var(--brand-blue)]">
                        {index + 1}
                      </span>
                      {step}
                    </div>
                  ))}
                </div>
                <div className="grid gap-3">
                  {[
                    "Start read-only before any signer or live route appears.",
                    "Reuse the same plan whether an agent, product, or operator owns the run.",
                    "Inspect receipts after execution.",
                  ].map((point) => (
                    <div
                      key={point}
                      className="rounded-[22px] border border-black/6 bg-[#fafbfe] px-4 py-4 text-sm leading-6 text-foreground/74 dark:border-white/10 dark:bg-black/20"
                    >
                      {point}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[24px] border border-black/6 bg-white/84 py-0 shadow-[0_18px_60px_rgba(12,18,28,0.06)] backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
              <CardHeader className="px-6 py-6">
                <CardTitle className="text-xl tracking-[-0.04em]">
                  How it looks in each path
                </CardTitle>
                <CardDescription className="text-sm leading-6 text-muted-foreground">
                  Same workflow logic. Different control surface.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <Tabs defaultValue="agent" className="gap-5">
                  <TabsList className="h-auto w-full flex-wrap rounded-[22px] bg-[#eef3fb] p-1 dark:bg-white/6">
                    {examplePanels.map((panel) => (
                      <TabsTrigger
                        key={panel.id}
                        value={panel.id}
                        className="rounded-full px-4 py-2 text-sm data-active:bg-white data-active:shadow-[0_8px_24px_rgba(12,18,28,0.08)] dark:data-active:bg-white/10"
                      >
                        {panel.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {examplePanels.map((panel) => (
                    <TabsContent
                      key={panel.id}
                      value={panel.id}
                      className="space-y-3"
                    >
                      <p className="text-sm leading-6 text-muted-foreground">
                        {panel.caption}
                      </p>
                      <CodeBlock code={panel.code} shell={panel.shell} tone="dark" />
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </SectionFrame>

        <SectionFrame
          id="trust"
          eyebrow="Proof"
          title="The homepage proof set."
          description="Read-only first. Dry-run when possible. Controlled trust. Receipts."
        >
          <div className="grid gap-4 md:grid-cols-3">
            {proofLinks.slice(0, 3).map((link) => (
              <a
                key={link.title}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-[22px] border border-black/6 bg-white/78 px-5 py-5 text-left shadow-[0_18px_60px_rgba(12,18,28,0.06)] backdrop-blur-xl transition-transform duration-300 hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/6"
              >
                <p className="text-sm font-medium tracking-[-0.03em] text-foreground">
                  {link.title}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {link.summary}
                </p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[var(--brand-blue)]">
                  Open proof
                  <ArrowRight className="size-4" />
                </span>
              </a>
            ))}
          </div>
        </SectionFrame>
      </main>

      <footer className="border-t border-black/6 px-5 py-8 sm:px-6 lg:px-8 dark:border-white/8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium tracking-[-0.02em]">
              Pandora runtime
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              One runtime for agents, builders, and operators.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "h-10 rounded-full border-black/8 bg-white/70 px-4 dark:border-white/10 dark:bg-white/5"
                )}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}

function CodeBlock({
  code,
  shell,
  tone = "light",
}: {
  code: string
  shell?: string
  tone?: "light" | "dark"
}) {
  const [copied, setCopied] = useState(false)
  const isDark = tone === "dark"

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  const buttonClassName = isDark
    ? "inline-flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/78 transition hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)]"
    : "absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full border border-black/8 bg-white text-foreground/72 shadow-[0_8px_24px_rgba(12,18,28,0.08)] transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] dark:border-white/10 dark:bg-[#14171d] dark:text-white/78"

  const copyLabel = copied ? "Copied" : "Copy code"

  if (isDark) {
    return (
      <div className="overflow-hidden rounded-[24px] border border-black/6 bg-[#0f1115] shadow-[0_20px_55px_rgba(10,15,24,0.24)] dark:border-white/10">
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <div className="flex gap-2">
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/10" />
          </div>
          <div className="flex items-center gap-2">
            {shell ? (
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/42">
                {shell}
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleCopy}
              className={buttonClassName}
              aria-label={copyLabel}
              title={copyLabel}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
        </div>
        <pre className="overflow-x-auto px-5 py-5 text-[13px] leading-7 text-white/84">
          <code>{code}</code>
        </pre>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-[22px] border border-black/6 bg-[#fafbfe] dark:border-white/10 dark:bg-black/20">
      <button
        type="button"
        onClick={handleCopy}
        className={buttonClassName}
        aria-label={copyLabel}
        title={copyLabel}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
      <pre className="overflow-x-auto px-4 py-3 pr-14 font-mono text-[13px] leading-6 text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function SectionFrame({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 px-5 py-12 sm:px-6 lg:px-8 lg:py-16"
    >
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-8 max-w-3xl space-y-4">
          <p className="text-[12px] font-medium tracking-[0.08em] text-[var(--brand-blue)]">
            {eyebrow}
          </p>
          <h2 className="text-[clamp(1.8rem,2.5vw,2.65rem)] font-semibold tracking-[-0.06em] text-foreground">
            {title}
          </h2>
          <p className="max-w-[42rem] text-[0.98rem] leading-7 text-muted-foreground sm:text-[1.02rem]">
            {description}
          </p>
        </div>
        {children}
      </div>
    </section>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const isDark = theme === "dark"

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-11 rounded-full border-black/10 bg-white/70 px-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/5"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <SunMedium className="size-4" /> : <MoonStar className="size-4" />}
      <span className="hidden sm:inline">{isDark ? "Light" : "Dark"}</span>
    </Button>
  )
}

export default App
