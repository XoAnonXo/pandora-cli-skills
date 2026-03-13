const variations = [
  {
    id: 'signal-deck',
    themeClass: 'theme-signal-deck',
    themeColor: '#071019',
    label: 'Signal Deck',
    mood: 'Dark launch energy with market pressure and polished motion.',
    useCase: 'Best if the homepage should feel like Pandora already has velocity.',
    eyebrow: 'Agents on first contact',
    title: 'Prediction-market infrastructure for agents that move before the market does.',
    description:
      'This direction treats Codex and Claude Code as front doors, then proves Pandora with real MCP, CLI, and SDK flows. It is the most launch-ready of the four concepts.',
    tone: 'Launch / editorial',
    heroCardTitle: 'First-click behavior',
    heroCardBody:
      'Copy a ready prompt, open the agent environment, then let Pandora bootstrap itself safely before any signer or policy decision.',
    focusLabel: 'Agent-first, operator-legible',
    focusBody:
      'The hero is optimized for the person already reaching for an agent, while still making the CLI and SDK surfaces visible in the same scan.',
    rationale:
      'Blend Pandora’s market-native energy with Stripe-level clarity and the outcome-first posture used by Codex and Claude Code.',
    facts: ['Codex + Claude up front', 'Market-native motion', 'Fastest to launch'],
    signalWords: ['bootstrap', 'mcp', 'skills', 'quote', 'mirror', 'sports', 'receipts'],
    promptPreview: [
      '$ npm install',
      '$ npx pandora --output json bootstrap',
      '$ npx pandora mcp',
      '',
      'Let the agent inspect the contract surface before any mutation.',
    ].join('\n'),
  },
  {
    id: 'operator-ledger',
    themeClass: 'theme-operator-ledger',
    themeColor: '#f4eee3',
    label: 'Operator Ledger',
    mood: 'Editorial paper, spec-sheet rhythm, high trust.',
    useCase: 'Best if the homepage should feel official, durable, and reviewer-friendly.',
    eyebrow: 'For operators who need proof before hype',
    title: 'A promotional surface that still reads like a serious control plane.',
    description:
      'This concept lowers the visual temperature and increases legibility. It is the cleanest option if Pandora should feel like a trusted product surface, not a campaign page.',
    tone: 'Trust / system',
    heroCardTitle: 'Homepage promise',
    heroCardBody:
      'Show the exact steps: bootstrap read-only, run local MCP, keep CLI work deterministic, then graduate to SDK embedding when builders need code-level access.',
    focusLabel: 'Most balanced for review',
    focusBody:
      'This is the strongest option for an audience that includes operators, reviewers, partners, or anyone who wants trust signals before they want spectacle.',
    rationale:
      'Borrow the calm confidence of Stripe and Supabase while preserving just enough Pandora edge to avoid a generic docs facade.',
    facts: ['Cleanest command proof', 'Highest trust density', 'Easy handoff to docs'],
    signalWords: ['capabilities', 'schema', 'policy list', 'profile list', 'operations', 'audit'],
    promptPreview: [
      '$ npx pandora --output json bootstrap',
      '$ npx pandora --output json capabilities',
      '$ npx pandora --output json schema',
      '',
      'Readable enough for humans, structured enough for agents.',
    ].join('\n'),
  },
  {
    id: 'arena-tape',
    themeClass: 'theme-arena-tape',
    themeColor: '#040605',
    label: 'Arena Tape',
    mood: 'Hardcore terminal maximalism with loud urgency.',
    useCase: 'Best if the homepage should magnetize advanced builders and agent operators.',
    eyebrow: 'For hardcore devs who want the sharp edges',
    title: 'Make Pandora feel like the place where agents trade, test, and build in public.',
    description:
      'This direction turns the homepage into a live tape: denser, louder, more technical. It intentionally leans into MCP, terminal commands, and the thrill of programmable market operations.',
    tone: 'Terminal / arena',
    heroCardTitle: 'Behavioral target',
    heroCardBody:
      'The viewer should feel that Pandora is not a demo. It is a serious runtime with enough surface area for market creation, mirroring, sports flows, and policy-aware execution.',
    focusLabel: 'Most technical and kinetic',
    focusBody:
      'This concept works best when the audience already speaks CLI, MCP, and SDK fluently and wants a homepage with more voltage than reassurance.',
    rationale:
      'Take the live-system pressure of developer tooling sites and push it through a market-tape lens so Pandora feels active, opinionated, and unapologetically technical.',
    facts: ['Loudest dev appeal', 'Strong MCP/CLI bias', 'Distinct from safe AI sites'],
    signalWords: ['trade', 'lp', 'mirror go', 'sports sync', 'risk', 'dashboard', 'stream'],
    promptPreview: [
      '$ npx pandora quote --output json --market-address 0x... --side yes --amount-usdc 25',
      '$ npx pandora scan --output json --limit 10',
      '$ npx pandora mcp',
      '',
      'Show commands early. Let the homepage earn its swagger.',
    ].join('\n'),
  },
  {
    id: 'protocol-garden',
    themeClass: 'theme-protocol-garden',
    themeColor: '#f2efe8',
    label: 'Protocol Garden',
    mood: 'Warm builder studio with softer motion and broader appeal.',
    useCase: 'Best if the homepage should convert both agent users and SDK builders over time.',
    eyebrow: 'For teams building on top, not just poking around',
    title: 'The warmest version of Pandora: still sharp, but easier to grow into.',
    description:
      'This concept is the bridge between launch energy and long-term builder adoption. It softens the page without losing its command-first posture or its protocol credibility.',
    tone: 'Builder / studio',
    heroCardTitle: 'Adoption strategy',
    heroCardBody:
      'Lead with agent actions, then open into SDK pathways, recipes, policy profiles, and proof that Pandora can scale from instant prompts to real product integrations.',
    focusLabel: 'Best for long-lived adoption',
    focusBody:
      'This is the easiest concept to evolve into a durable marketing site because it can host bolder launch copy while still feeling approachable to builders and product teams.',
    rationale:
      'Borrow Supabase’s self-serve friendliness and Vercel AI’s builder bias, then keep Pandora’s personality in the typography and background system.',
    facts: ['Most SDK-friendly', 'Warmest entry point', 'Balanced long-term option'],
    signalWords: ['typescript sdk', 'python sdk', 'recipes', 'generated contracts', 'builders'],
    promptPreview: [
      '$ npm install @thisispandora/agent-sdk@alpha',
      "$ const client = createPandoraAgentClient({ command: 'pandora', args: ['mcp'] })",
      '$ await client.getBootstrap()',
      '',
      'Show builders how fast they can embed the same contract surface.',
    ].join('\n'),
  },
]

const audiences = [
  {
    title: 'Agents',
    badge: 'Fastest path',
    summary: 'Pandora should feel instantly usable inside Codex, Claude Code, and any MCP-capable runtime.',
    bullets: [
      'Start read-only with bootstrap, capabilities, schema, policy list, and profile list.',
      'Use local stdio MCP for the default self-custody execution path.',
      'Offer remote HTTP MCP as a read-only planning gateway when teams need shared discovery.',
    ],
    command: 'npm install && npx pandora mcp',
  },
  {
    title: 'CLI',
    badge: 'Deterministic path',
    summary: 'Operators need the site to show that Pandora is not only agent-friendly. It is also direct, scriptable, and auditable.',
    bullets: [
      'Use the human setup sequence from the repo: init-env, doctor, build, help.',
      'Keep safe exploration visible with bootstrap, capabilities, schema, and policy/profile listing.',
      'Highlight quote, scan, trade, LP, claim, mirror, sports, and operations receipts as real commands.',
    ],
    command: 'npm install && npm run init-env && npm run doctor && npm run build && npx pandora help',
  },
  {
    title: 'SDK',
    badge: 'Embed path',
    summary: 'Hardcore devs should immediately see that the same surface can be embedded from TypeScript or Python.',
    bullets: [
      'TypeScript package: @thisispandora/agent-sdk@alpha with local stdio or remote HTTP MCP clients.',
      'Python package: pandora-agent with the same bootstrap-oriented flow.',
      'Generated contracts, CJS/ESM support, and package-local inspection are strong builder proof.',
    ],
    command: 'npm install @thisispandora/agent-sdk@alpha',
  },
]

const proofBlocks = [
  {
    title: 'Safe bootstrap',
    note: 'Canonical read-only entry point for agents and humans before secrets or mutation.',
    command: 'npm install && npx pandora --output json bootstrap',
  },
  {
    title: 'Local stdio MCP',
    note: 'Default self-custody path when the agent runs on the same machine as Pandora.',
    command: 'npm install && npx pandora mcp',
  },
  {
    title: 'Remote planning gateway',
    note: 'Hosted read-only HTTP MCP path for discovery, schema, recipes, audit, and receipts.',
    command:
      'npm install && npx pandora mcp http --auth-scopes capabilities:read,contracts:read,help:read,schema:read,operations:read,scan:read,quote:read,portfolio:read,mirror:read,sports:read,network:indexer,network:rpc,network:polymarket,network:sports',
  },
  {
    title: 'CLI discovery and quoting',
    note: 'Promote real command-level proof, not vague feature labels.',
    command:
      'npx pandora scan --output json --limit 10\nnpx pandora quote --output json --market-address 0x... --side yes --amount-usdc 25',
  },
  {
    title: 'TypeScript SDK',
    note: 'Public alpha package for apps that want the same contract surface from code.',
    command:
      "npm install @thisispandora/agent-sdk@alpha\nconst client = createPandoraAgentClient({ command: 'pandora', args: ['mcp'] })\nawait client.getBootstrap()",
  },
  {
    title: 'Python SDK',
    note: 'Mirror the same story for Python teams that want local or remote Pandora clients.',
    command:
      'pip install pandora-agent==0.1.0a15\nclient = create_local_pandora_agent_client(command="pandora")\nbootstrap = client.get_bootstrap()',
  },
]

const skillCards = [
  {
    title: 'Skills become workflows',
    copy: 'The site should show that Pandora does not stop at tool exposure. Skills and recipes make common market operations feel outcome-first for agents.',
    tags: ['skills', 'recipes', 'agent quickstart'],
  },
  {
    title: 'Policies and profiles keep mutation deliberate',
    copy: 'Policy packs, signer profiles, and readiness checks are one of Pandora’s strongest trust signals. They deserve visible homepage space.',
    tags: ['policy list', 'profile list', 'profile explain'],
  },
  {
    title: 'Operations receipts make actions auditable',
    copy: 'Persisted operation receipts and verification flows are concrete proof that Pandora is built for real execution, not just demos.',
    tags: ['operations list', 'receipt', 'verify-receipt'],
  },
  {
    title: 'The surface area is unusually broad',
    copy: 'Trading, LP, mirror strategies, sports workflows, portfolio views, risk, and dashboard surfaces make Pandora feel like a runtime, not a thin wrapper.',
    tags: ['trade', 'lp', 'mirror', 'sports', 'portfolio', 'risk'],
  },
]

const researchItems = [
  {
    name: 'Pandora',
    href: 'https://thisispandora.ai',
    borrow: 'Use bold market-native energy so the site feels alive before anyone scrolls.',
    linkLabel: 'Open Pandora',
    linkAriaLabel: 'Open Pandora reference site in a new tab',
  },
  {
    name: 'Model Context Protocol',
    href: 'https://modelcontextprotocol.io',
    borrow: 'Explain the contract and ecosystem clearly so agents, tools, and servers feel legible.',
    linkLabel: 'Open MCP',
    linkAriaLabel: 'Open Model Context Protocol reference site in a new tab',
  },
  {
    name: 'Stripe',
    href: 'https://stripe.com',
    borrow: 'Front-load trust, code posture, and crisp product framing in the first screenful.',
    linkLabel: 'Open Stripe',
    linkAriaLabel: 'Open Stripe reference site in a new tab',
  },
  {
    name: 'Supabase',
    href: 'https://supabase.com',
    borrow: 'Make the audience split obvious: self-serve for builders, still clear for evaluators.',
    linkLabel: 'Open Supabase',
    linkAriaLabel: 'Open Supabase reference site in a new tab',
  },
  {
    name: 'Vercel AI',
    href: 'https://vercel.com/ai',
    borrow: 'Tie the homepage directly to starter behavior so adoption feels immediate.',
    linkLabel: 'Open Vercel AI',
    linkAriaLabel: 'Open Vercel AI reference site in a new tab',
  },
  {
    name: 'OpenAI Codex',
    href: 'https://openai.com/codex/',
    borrow: 'Use outcome language around delegation, terminals, and shipping work instead of empty AI slogans.',
    linkLabel: 'Open Codex',
    linkAriaLabel: 'Open Codex reference site in a new tab',
  },
  {
    name: 'Anthropic Claude Code',
    href: 'https://claude.com/product/claude-code',
    borrow: 'Keep the codebase-aware, agent-plus-terminal framing visible and credible.',
    linkLabel: 'Open Claude Code',
    linkAriaLabel: 'Open Claude Code reference site in a new tab',
  },
]

const actionMap = {
  codex: {
    label: 'Codex',
    url: 'https://openai.com/codex/',
    content: [
      'Open this repository and treat Pandora as an agent-first prediction-market runtime.',
      'Run `npm install` if needed, then `npx pandora --output json bootstrap`.',
      'Inspect the CLI, MCP, SDK, and Skills surfaces before proposing any mutation.',
      'Prefer safe read-only discovery first, then recommend the fastest next action for an operator or builder.',
    ].join('\n'),
  },
  claude: {
    label: 'Claude Code',
    url: 'https://claude.ai',
    content: [
      'Use Pandora as the command surface for prediction-market operations.',
      'Start with `npx pandora --output json bootstrap`, then inspect capabilities, schema, policy list, and profile list.',
      'Explain how to use local stdio MCP first, and only suggest broader execution after readiness is clear.',
    ].join('\n'),
  },
  mcp: {
    label: 'Local MCP command',
    target: '#proof',
    content: 'npm install && npx pandora mcp',
  },
  sdk: {
    label: 'SDK quickstart',
    target: '#proof',
    content: [
      'TypeScript:',
      'npm install @thisispandora/agent-sdk@alpha',
      '',
      'Python:',
      'pip install pandora-agent==0.1.0a15',
    ].join('\n'),
  },
  bootstrap: {
    label: 'Bootstrap command',
    target: '#proof',
    content: 'npm install && npx pandora --output json bootstrap',
  },
}

const themeClasses = variations.map((variation) => variation.themeClass)
const variationIds = new Set(variations.map((variation) => variation.id))
const baseDocumentTitle = 'Pandora Promotional Website Concepts'

const elements = {
  body: document.body,
  heroEyebrow: document.getElementById('heroEyebrow'),
  heroTitle: document.getElementById('heroTitle'),
  heroDescription: document.getElementById('heroDescription'),
  heroTone: document.getElementById('heroTone'),
  heroCardTitle: document.getElementById('heroCardTitle'),
  heroCardBody: document.getElementById('heroCardBody'),
  focusLabel: document.getElementById('focusLabel'),
  focusBody: document.getElementById('focusBody'),
  conceptRationale: document.getElementById('conceptRationale'),
  heroFacts: document.getElementById('heroFacts'),
  actionPreview: document.getElementById('actionPreview'),
  actionStatus: document.getElementById('actionStatus'),
  signalTrack: document.getElementById('signalTrack'),
  variationButtons: Array.from(document.querySelectorAll('[data-variation]')),
  variationList: document.getElementById('variationList'),
  variationStatus: document.getElementById('variationStatus'),
  audienceGrid: document.getElementById('audienceGrid'),
  proofGrid: document.getElementById('proofGrid'),
  skillGrid: document.getElementById('skillGrid'),
  researchGrid: document.getElementById('researchGrid'),
  themeColorMeta: document.querySelector('meta[name="theme-color"]'),
}

let currentVariationId = variations[0].id
const reducedMotionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderFacts(facts) {
  elements.heroFacts.innerHTML = facts.map((fact) => `<span class="fact-pill">${escapeHtml(fact)}</span>`).join('')
}

function renderSignalWords(words) {
  const repeated = [...words, ...words, ...words]
  elements.signalTrack.innerHTML = repeated
    .map((word) => `<span class="signal-word">${escapeHtml(word)}</span>`)
    .join('')
}

function updateVariationButtons() {
  elements.variationButtons.forEach((button) => {
    const isActive = button.getAttribute('data-variation') === currentVariationId
    button.classList.toggle('is-active', isActive)
    button.setAttribute('aria-checked', isActive ? 'true' : 'false')
    button.tabIndex = isActive ? 0 : -1
  })
}

function focusVariationButton(id) {
  const nextButton = elements.variationButtons.find((button) => button.getAttribute('data-variation') === id)
  if (nextButton) {
    nextButton.focus()
  }
}

function renderAudienceGrid() {
  elements.audienceGrid.innerHTML = audiences
    .map(
      (audience) => `
        <article class="info-card">
          <div class="card-topline">
            <span class="pill">${escapeHtml(audience.badge)}</span>
            <span class="mini-label">${escapeHtml(audience.title)}</span>
          </div>
          <p class="card-copy">${escapeHtml(audience.summary)}</p>
          <ul class="bullet-list">
            ${audience.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}
          </ul>
          <pre class="code-block">${escapeHtml(audience.command)}</pre>
        </article>
      `,
    )
    .join('')
}

function renderProofGrid() {
  elements.proofGrid.innerHTML = proofBlocks
    .map(
      (block) => `
        <article class="info-card">
          <p class="mini-label">${escapeHtml(block.title)}</p>
          <p class="card-copy">${escapeHtml(block.note)}</p>
          <pre class="code-block">${escapeHtml(block.command)}</pre>
        </article>
      `,
    )
    .join('')
}

function renderSkillGrid() {
  elements.skillGrid.innerHTML = skillCards
    .map(
      (card) => `
        <article class="info-card skill-card">
          <p class="mini-label">${escapeHtml(card.title)}</p>
          <p class="card-copy">${escapeHtml(card.copy)}</p>
          <div class="tag-row">
            ${card.tags.map((tag) => `<span class="fact-pill">${escapeHtml(tag)}</span>`).join('')}
          </div>
        </article>
      `,
    )
    .join('')
}

function renderResearchGrid() {
  elements.researchGrid.innerHTML = researchItems
    .map(
      (item) => `
        <article class="info-card research-card">
          <p class="mini-label">${escapeHtml(item.name)}</p>
          <p class="card-copy">${escapeHtml(item.borrow)}</p>
          <a
            class="text-link"
            href="${escapeHtml(item.href)}"
            target="_blank"
            rel="noreferrer"
            aria-label="${escapeHtml(item.linkAriaLabel)}"
          >${escapeHtml(item.linkLabel)}</a>
        </article>
      `,
    )
    .join('')
}

function getVariationFromLocation() {
  const currentUrl = new URL(window.location.href)
  const queryVariation = currentUrl.searchParams.get('variation')

  if (queryVariation && variationIds.has(queryVariation)) {
    return queryVariation
  }

  const normalizedHash = currentUrl.hash.replace(/^#variation-?/, '').replace(/^#/, '')
  if (normalizedHash && variationIds.has(normalizedHash)) {
    return normalizedHash
  }

  return null
}

function syncVariationLocation(id) {
  try {
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.set('variation', id)
    history.replaceState(history.state, '', nextUrl)
  } catch {
    // File previews can restrict history mutation. The variation still applies visually.
  }
}

function updateDocumentTitle(variation) {
  document.title = `${baseDocumentTitle} · ${variation.label}`
}

function updateThemeColor(variation) {
  if (elements.themeColorMeta) {
    elements.themeColorMeta.setAttribute('content', variation.themeColor)
  }
}

function announceVariation(variation) {
  if (!elements.variationStatus) return
  elements.variationStatus.textContent = `Active concept: ${variation.label}. ${variation.useCase}`
}

function applyVariation(id, options = {}) {
  const { syncUrl = true } = options
  const variation = variations.find((item) => item.id === id) || variations[0]
  currentVariationId = variation.id

  elements.body.classList.remove(...themeClasses)
  elements.body.classList.add(variation.themeClass)

  elements.heroEyebrow.textContent = variation.eyebrow
  elements.heroTitle.textContent = variation.title
  elements.heroDescription.textContent = variation.description
  elements.heroTone.textContent = variation.tone
  elements.heroCardTitle.textContent = variation.heroCardTitle
  elements.heroCardBody.textContent = variation.heroCardBody
  elements.focusLabel.textContent = variation.focusLabel
  elements.focusBody.textContent = variation.focusBody
  elements.conceptRationale.textContent = variation.rationale
  elements.actionPreview.textContent = variation.promptPreview

  renderFacts(variation.facts)
  renderSignalWords(variation.signalWords)
  updateVariationButtons()
  updateDocumentTitle(variation)
  updateThemeColor(variation)
  announceVariation(variation)

  if (syncUrl) {
    syncVariationLocation(variation.id)
  }
}

async function copyToClipboard(content) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    return legacyCopyToClipboard(content)
  }

  try {
    await navigator.clipboard.writeText(content)
    return true
  } catch {
    return legacyCopyToClipboard(content)
  }
}

function legacyCopyToClipboard(content) {
  if (!document.body || typeof document.execCommand !== 'function') {
    return false
  }

  const previousActiveElement = document.activeElement
  const textarea = document.createElement('textarea')
  textarea.value = content
  textarea.setAttribute('readonly', 'readonly')
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus()
    }
  }
}

function maybeScrollToTarget(action) {
  if (action.target) {
    const target = document.querySelector(action.target)
    if (target) {
      const behavior = reducedMotionQuery?.matches ? 'auto' : 'smooth'
      target.scrollIntoView({ behavior, block: 'start' })
    }
  }
}

function openPendingWindow() {
  const nextWindow = window.open('', '_blank')
  if (nextWindow) {
    nextWindow.opener = null
  }

  return nextWindow
}

async function handleAction(actionKey) {
  const action = actionMap[actionKey]
  if (!action) return

  // Hold a tab open synchronously so we can still copy first without running into popup blocking.
  const pendingWindow = action.url ? openPendingWindow() : null

  const copied = await copyToClipboard(action.content)
  elements.actionPreview.textContent = action.content
  elements.actionStatus.textContent = copied
    ? `${action.label} copied. ${action.url ? 'Opening official destination.' : 'Jumping to the matching section.'}`
    : `${action.label} ready below. Clipboard access was not available in this browser.`

  if (action.url) {
    if (pendingWindow) {
      pendingWindow.location.replace(action.url)
      pendingWindow.focus()
    } else {
      window.open(action.url, '_blank', 'noopener,noreferrer')
    }
  }

  maybeScrollToTarget(action)
}

document.addEventListener('click', async (event) => {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  const actionButton = target.closest('[data-action]')
  if (actionButton) {
    await handleAction(actionButton.getAttribute('data-action'))
    return
  }

  const variationButton = target.closest('[data-variation]')
  if (variationButton) {
    applyVariation(variationButton.getAttribute('data-variation'))
  }
})

elements.variationList?.addEventListener('keydown', (event) => {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  const currentButton = target.closest('[data-variation]')
  if (!currentButton) {
    return
  }

  const currentIndex = elements.variationButtons.indexOf(currentButton)
  if (currentIndex === -1) {
    return
  }

  let nextIndex = null

  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      nextIndex = (currentIndex + 1) % elements.variationButtons.length
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      nextIndex = (currentIndex - 1 + elements.variationButtons.length) % elements.variationButtons.length
      break
    case 'Home':
      nextIndex = 0
      break
    case 'End':
      nextIndex = elements.variationButtons.length - 1
      break
    default:
      return
  }

  event.preventDefault()
  const nextVariationId = elements.variationButtons[nextIndex]?.getAttribute('data-variation')
  if (nextVariationId) {
    applyVariation(nextVariationId)
    focusVariationButton(nextVariationId)
  }
})

renderAudienceGrid()
renderProofGrid()
renderSkillGrid()
renderResearchGrid()
const initialVariationId = getVariationFromLocation()
applyVariation(initialVariationId || currentVariationId, { syncUrl: Boolean(initialVariationId) })
