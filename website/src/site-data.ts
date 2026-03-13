export type SurfaceKey = "cli" | "mcp" | "sdk" | "skills"

const repoBase = "https://github.com/XoAnonXo/pandora-cli-skills"
const docsBase = `${repoBase}/blob/main`
const latestRelease = `${repoBase}/releases/latest`

type WorkflowPanel = {
  title: string
  summary: string
  shell: string
  code: string
  note: string
}

type Workflow = {
  id: string
  label: string
  title: string
  summary: string
  focus: string
  highlights: string[]
  steps: string[]
  surfaceOrder: SurfaceKey[]
  panels: Record<SurfaceKey, WorkflowPanel>
}

export const navLinks = [
  { label: "Agents", href: "#agents" },
  { label: "Builders", href: "#builders" },
  { label: "Operators", href: "#operators" },
  { label: "Example", href: "#workflow" },
  { label: "Proof", href: "#trust" },
] as const

export const quickStarts = [
  {
    id: "agent",
    title: "For agents",
    audience: "Agents",
    summary:
      "Use MCP when an agent host should call Pandora tools directly.",
    code: `npm install pandora-cli-skills
npx pandora mcp`,
    href: `${docsBase}/docs/skills/agent-quickstart.md`,
    linkLabel: "Open agent quickstart",
  },
  {
    id: "builder",
    title: "For builders",
    audience: "Builders",
    summary:
      "Use the SDK when Pandora belongs inside a product or strategy system.",
    code: `npm install @thisispandora/agent-sdk@alpha
const { connectPandoraAgentClient } = require("@thisispandora/agent-sdk")`,
    href: `${docsBase}/sdk/typescript/README.md`,
    linkLabel: "Open SDK quickstart",
  },
  {
    id: "operator",
    title: "For operators",
    audience: "Operators",
    summary:
      "Use the CLI when a human or CI job should own the exact command path.",
    code: `npx pandora --output json portfolio --wallet 0xabc...
npx pandora --output json mirror sync once --execute-live false`,
    href: `${docsBase}/docs/skills/command-reference.md`,
    linkLabel: "Open CLI reference",
  },
] as const

export const proofLinks = [
  {
    title: "Release verification",
    summary: "Release gates, trust checks, and shipped artifacts.",
    href: `${docsBase}/docs/trust/release-verification.md`,
  },
  {
    title: "Support matrix",
    summary: "Supported surfaces, environments, and expectations.",
    href: `${docsBase}/docs/trust/support-matrix.md`,
  },
  {
    title: "Generated manifest",
    summary: "The generated contract that keeps every surface aligned.",
    href: `${docsBase}/sdk/generated/manifest.json`,
  },
  {
    title: "GitHub releases",
    summary: "Published bundles, assets, and release history.",
    href: latestRelease,
  },
] as const

export const surfaces = [
  {
    id: "cli",
    title: "CLI",
    audience: "Operators and CI",
    summary:
      "The terminal interface for humans and automation. Best when you want exact flags, readable output, and predictable JSON for scripts or CI.",
    example: "npx pandora --output json mirror sync once --execute-live false",
    whenToUse:
      "Choose this when the terminal is the control surface and you want direct command ownership.",
  },
  {
    id: "mcp",
    title: "MCP",
    audience: "Agents and hosts",
    summary:
      "Pandora exposed as tools for AI agents. Best when Codex, Claude, or another host should inspect capabilities and call Pandora directly.",
    example: "npx pandora mcp",
    whenToUse:
      "Choose this when an agent needs a tool surface instead of ad hoc shell commands.",
  },
  {
    id: "sdk",
    title: "SDK",
    audience: "Product and infra teams",
    summary:
      "TypeScript and Python libraries for teams that want Pandora inside a product, backend, service, or strategy system.",
    example: "npm install @thisispandora/agent-sdk",
    whenToUse:
      "Choose this when your team wants versioned contracts, examples, and integration code in the repo.",
  },
  {
    id: "skills",
    title: "Skills",
    audience: "Workflow authors",
    summary:
      "The guidance layer for agents and operators. Skills are not an execution surface; they explain the right order, risk posture, and recipe for a task.",
    example: "Use approved recipes before live execution.",
    whenToUse:
      "Choose this when you want repeatable workflows and less prompt improvisation.",
  },
] as const satisfies readonly {
  id: SurfaceKey
  title: string
  audience: string
  summary: string
  example: string
  whenToUse: string
}[]

export const workflows = [
  {
    id: "mirror",
    label: "Mirror sync",
    title: "Mirror a market safely",
    summary:
      "Scout the source, build the exact plan, validate the payload, then run paper or live sync with the same contract surface all the way through.",
    focus: "Read-only to live",
    highlights: [
      "Start with research and planning before any signer step appears.",
      "Keep exact payload reuse visible so the operator understands what changes and what does not.",
      "Make receipts, drift checks, and policy gating feel native to the flow.",
      "CLI, MCP, SDK, and Skills stay aligned around the same job.",
    ],
    steps: ["Research", "Plan", "Validate", "Execute", "Inspect"],
    surfaceOrder: ["cli", "mcp", "sdk", "skills"],
    panels: {
      cli: {
        title: "Operator-owned execution",
        summary: "Fastest path when a human is running the system directly.",
        shell: "cli",
        code: `npx pandora --output json mirror plan \\
  --source polymarket \\
  --market-id poly-cond-1

npx pandora --output json mirror sync once \\
  --state-file ./mirror-state.json \\
  --execute-live false`,
        note: "The CLI keeps flags explicit and produces stable JSON for logs and shell automation.",
      },
      mcp: {
        title: "Tool call flow for agents",
        summary: "Best when the agent host should drive the workflow step by step.",
        shell: "mcp",
        code: `bootstrap
-> schema
-> mirror.plan
-> mirror.sync.once
-> operations.receipt`,
        note: "MCP makes the tool surface inspectable before the model is allowed to execute mutation paths.",
      },
      sdk: {
        title: "Service integration flow",
        summary: "Use the generated client in apps, jobs, or internal strategy systems.",
        shell: "typescript",
        code: `const { connectPandoraAgentClient, loadGeneratedManifest } = require("@thisispandora/agent-sdk")
const client = await connectPandoraAgentClient({
  command: "pandora",
  args: ["mcp"],
})

const manifest = loadGeneratedManifest()`,
        note: "The SDK gives product teams a real client plus generated contract metadata they can version and review.",
      },
      skills: {
        title: "Guided prompt path",
        summary: "Teach the agent the order of operations instead of hoping it invents one.",
        shell: "skills",
        code: `1. Compare source candidates
2. Build the plan
3. Prefer paper mode first
4. Reuse the validated payload
5. Inspect receipts and drift`,
        note: "Skills make the sequence legible to the model and reduce prompt drift across repeated runs.",
      },
    },
  },
  {
    id: "portfolio",
    label: "Claim scan",
    title: "Scan a portfolio and claim finalized positions",
    summary:
      "Lead with safe discovery, then narrow into validated claim actions only for the positions that are actually ready.",
    focus: "Read-only discovery",
    highlights: [
      "Discovery should stay separate from mutation so the user sees what is claimable before any write happens.",
      "Agents need structured claimability signals, not just raw balances.",
      "The UI should show this as an automation-friendly recipe, not a buried edge case.",
      "This is where Skills and MCP become especially useful together.",
    ],
    steps: ["Inspect", "Filter", "Validate", "Claim"],
    surfaceOrder: ["mcp", "cli", "skills", "sdk"],
    panels: {
      cli: {
        title: "Read-first CLI workflow",
        summary: "Terminal-friendly path for wallet operators.",
        shell: "cli",
        code: `npx pandora --output json portfolio --wallet 0xabc...
npx pandora --output json recipe validate --id claim.all.finalized
npx pandora --output json recipe run --id claim.all.finalized`,
        note: "The command path stays predictable and makes the read-first posture obvious.",
      },
      mcp: {
        title: "Agent discovery workflow",
        summary: "Ideal when an agent is scanning and proposing next actions.",
        shell: "mcp",
        code: `portfolio
-> recipe.list
-> recipe.get(id="claim.all.finalized")
-> recipe.validate
-> recipe.run`,
        note: "This is the cleanest illustration of why MCP plus Skills are better than a raw shell wrapper.",
      },
      sdk: {
        title: "Backend orchestration path",
        summary: "Use when portfolio scan is part of a dashboard or automation service.",
        shell: "python",
        code: `from pandora_agent import create_remote_pandora_agent_client

with create_remote_pandora_agent_client(
    url=os.environ["PANDORA_MCP_URL"],
    auth_token=os.environ["PANDORA_MCP_TOKEN"],
) as client:
    bootstrap = client.get_bootstrap()`,
        note: "The Python SDK is useful when portfolio discovery needs to sit inside a service or internal dashboard.",
      },
      skills: {
        title: "Safety guidance for the model",
        summary: "A short recipe is often more reliable than a long freeform prompt.",
        shell: "skills",
        code: `Use approved claim recipes first.
Prefer read-only scans before execution.
Call out trust status and policy readiness
before any live claim path.`,
        note: "The site should show that Skills are operational guidance, not another execution surface.",
      },
    },
  },
  {
    id: "create",
    label: "Market create",
    title: "Create and launch a market",
    summary:
      "Explain the highest-risk workflow with calm structure: plan first, verify profiles and routing, then expose the exact live entry points.",
    focus: "Execution posture",
    highlights: [
      "Planning and live mutation are different phases and should stay visibly separate.",
      "Routing choices like public, private, or Flashbots belong in the execution layer, not the hero copy.",
      "MCP should look as capable as the CLI, not like a reduced wrapper.",
      "This is where developers see why generated schemas and profiles matter.",
    ],
    steps: ["Plan", "Inspect", "Route", "Execute", "Receipt"],
    surfaceOrder: ["cli", "mcp", "sdk", "skills"],
    panels: {
      cli: {
        title: "Explicit operator flow",
        summary: "Strongest when a signer-owning human is deciding route and execution posture.",
        shell: "cli",
        code: `npx pandora --output json markets create plan \\
  --question "Will X happen?" \\
  --market-type amm

npx pandora --output json markets create run \\
  --tx-route auto`,
        note: "The CLI is still the clearest surface for direct signer-owned operation and route control.",
      },
      mcp: {
        title: "Agent-native execution path",
        summary: "Use when the host should inspect schemas and readiness before mutation.",
        shell: "mcp",
        code: `bootstrap
-> schema
-> profile.list
-> profile.explain
-> markets.create.plan
-> markets.create.run`,
        note: "MCP is a first-class execution surface with the same contract power as the CLI path.",
      },
      sdk: {
        title: "Contract-aware product integration",
        summary: "Use when market creation is part of a product, internal tool, or strategy engine.",
        shell: "typescript",
        code: `const { createPandoraAgentClient, loadGeneratedContractRegistry } = require("@thisispandora/agent-sdk")

const client = createPandoraAgentClient({
  mode: "remote",
  url: process.env.PANDORA_MCP_URL,
  authToken: process.env.PANDORA_MCP_TOKEN,
})

const registry = loadGeneratedContractRegistry()`,
        note: "The SDK path is about client integration plus generated contracts that stay visible in code review.",
      },
      skills: {
        title: "Operational recipe",
        summary: "Frame the safe sequence the agent should follow around a high-risk action.",
        shell: "skills",
        code: `Start read-only.
Inspect profiles and policy scope.
Prefer plan output before live mutation.
Only widen trust when execution requires it.`,
        note: "The page should teach the operational posture, not only list the command surface.",
      },
    },
  },
] as const satisfies readonly Workflow[]

export const recipeCards = [
  {
    title: "Mirror sync in paper mode",
    area: "Mirror",
    risk: "paper-safe",
    summary: "Preview sync behavior and drift without live trust.",
    outcome: "Best first entry point for a new operator or agent trying to understand the mirror path.",
  },
  {
    title: "Claim finalized positions",
    area: "Portfolio",
    risk: "dry-run",
    summary: "Inspect claimable positions before choosing a live claim path.",
    outcome: "Shows safe discovery plus execution-ready recipes in one compact path.",
  },
  {
    title: "Plan a Polymarket mirror",
    area: "Research",
    risk: "read-only",
    summary: "Scout a source market and produce a plan before any sync step.",
    outcome: "Useful for agent hosts that need a planning surface without touching signers.",
  },
  {
    title: "Preview a pari-mutuel deployment",
    area: "Markets",
    risk: "dry-run",
    summary: "Generate the deploy shape and inspect constraints before the operator decides to write.",
    outcome: "Demonstrates why plan and run belong as separate visible concepts on the page.",
  },
] as const

export const trustLayers = [
  {
    id: "policies",
    title: "Policy profiles",
    summary:
      "Profiles and trust scopes keep read-only, dry-run, and live execution visibly separate.",
    detail:
      "Pandora expands authority deliberately, and that matters more than glossy feature claims.",
  },
  {
    id: "contracts",
    title: "Generated contracts",
    summary:
      "CLI, MCP, and SDK surfaces stay aligned because the contract is generated and validated, not rewritten by hand.",
    detail:
      "This is how Pandora earns credibility with product and strategy teams that care about drift, tests, and reviewability.",
  },
  {
    id: "releases",
    title: "Release verification",
    summary:
      "Signed artifacts, readiness checks, smoke tests, and provenance all belong in the product story.",
    detail:
      "The strongest Pandora story is not only capability. It is the proof that the capability is shipped carefully.",
  },
] as const

export const releaseStages = [
  {
    label: "Bootstrap",
    badge: "Read-only",
    summary:
      "Start with capabilities, schema, and profile information before any execution path is presented.",
  },
  {
    label: "Plan",
    badge: "Dry-run first",
    summary:
      "Build and validate the exact payload so the operator or agent can see what would happen before it happens.",
  },
  {
    label: "Execute",
    badge: "Controlled trust",
    summary:
      "Only widen into signer-backed execution when the chosen workflow actually requires it.",
  },
  {
    label: "Inspect",
    badge: "Receipts",
    summary:
      "Operation receipts, logs, and final state make the workflow auditable after the fact.",
  },
] as const

export type DocTrack = {
  id: "operators" | "agents" | "builders" | "recipes"
  title: string
  summary: string
  points: string[]
  href: string
  linkLabel: string
}

export const docTracks = [
  {
    id: "agents",
    title: "Start with an agent",
    summary:
      "The fastest path for Codex, Claude, or another MCP host to discover Pandora safely.",
    points: [
      "Bootstrap first, then expose Pandora through MCP.",
      "Use Skills as guidance, not as the transport layer.",
      "Keep mutation behind explicit readiness checks.",
    ],
    href: `${docsBase}/docs/skills/agent-quickstart.md`,
    linkLabel: "Open agent quickstart",
  },
  {
    id: "operators",
    title: "Run from the CLI",
    summary:
      "Use the terminal when a human operator or CI job should own exact flags and output.",
    points: [
      "Read-only and dry-run modes are first-class.",
      "Flags, profiles, and receipts stay explicit.",
      "Command reference remains the fastest manual path.",
    ],
    href: `${docsBase}/docs/skills/command-reference.md`,
    linkLabel: "Open CLI reference",
  },
  {
    id: "builders",
    title: "Build with the SDK",
    summary:
      "Use the SDK and generated contracts when Pandora becomes part of a product, backend, or strategy workflow.",
    points: [
      "TypeScript and Python packages stay aligned.",
      "Generated manifests and contract registries are checked into the repo.",
      "Examples exist for local stdio and remote HTTP patterns.",
    ],
    href: `${docsBase}/sdk/typescript/README.md`,
    linkLabel: "Open SDK docs",
  },
  {
    id: "recipes",
    title: "Author recipes and skills",
    summary:
      "Turn repeatable operating knowledge into skills and recipes the model can follow every time.",
    points: [
      "Recipe-driven behavior instead of prompt drift.",
      "Tighter trust posture and better handoffs.",
      "Clear operational language for new team members and agents.",
    ],
    href: `${docsBase}/docs/skills/recipes.md`,
    linkLabel: "Open recipe docs",
  },
] as const satisfies readonly DocTrack[]
