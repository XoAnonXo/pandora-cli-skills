#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function buildScenarioPrompt(payload) {
  const scenario = payload && typeof payload === 'object' ? payload : {};
  const kind = String(scenario.kind || '').trim();
  const request = String(scenario.userPrompt || scenario.prompt || '').trim();
  const requestLower = request.toLowerCase();
  const wantsQuotePath = requestLower.includes('quote')
    || requestLower.includes('buy-side')
    || (requestLower.includes('buy') && requestLower.includes('market'))
    || (requestLower.includes('trade') && requestLower.includes('market'));
  if (!request) return '';
  const instructions = [];
  if (kind === 'trigger-should' || kind === 'trigger-paraphrase' || kind === 'functional') {
    instructions.push('Use Pandora tools directly when they are relevant to answer this request.');
    instructions.push('Use the minimum number of Pandora tools needed.');
    instructions.push('Do not only describe Pandora tools without calling them.');
    instructions.push('Do not claim that a Pandora tool was denied or unavailable unless you actually received a tool denial from the runtime.');
    instructions.push('When the installed Pandora skill names multiple first commands for a workflow, list each named command explicitly instead of collapsing them into one conceptual step.');
    instructions.push('When the installed Pandora skill names a canonical exact tool or gate, prefer that exact tool or gate over nearby lower-level detail tools.');
    instructions.push('Do not stop at a pure clarification question. If concrete execution inputs are missing, first use the smallest relevant Pandora discovery surface or Pandora-specific tool search, then state the missing input needed for the next step.');
    instructions.push('Prefer targeted Pandora tools over broad inventory dumps unless the request is explicitly about bootstrap or capabilities.');
    if (requestLower.includes('bootstrap')) {
      instructions.push('For bootstrap answers, explicitly name bootstrap, capabilities, and schema.');
    }
    if (requestLower.includes('99.9/0.1') || requestLower.includes('parimutuel') || requestLower.includes('amm')) {
      instructions.push('For market-type teaching answers, explicitly explain both AMM and parimutuel in plain language, explain what a skewed distribution such as 99.9/0.1 means, and keep the user in planning or validation mode before any live deployment step.');
    }
    if (
      requestLower.includes('suggest')
      || requestLower.includes('launch this week')
      || requestLower.includes('market ideas')
      || (requestLower.includes('market') && requestLower.includes('this week'))
    ) {
      instructions.push('For market suggestion answers, explicitly prefer markets.hype.plan as the default Pandora suggestion path, explicitly frame provider-backed planning as the real-user path, explicitly call mock deterministic test-only mode, and mention agent market hype only as fallback or orchestration mode.');
    }
    if (wantsQuotePath || requestLower.includes('buy yes') || requestLower.includes('buy no')) {
      instructions.push('For quote or buy-side answers, keep the path narrow: quote first, trade later, and if identifiers are missing mention scan or markets list|get before asking for the final market selector.');
      instructions.push('For a generic buy request, do not start with polymarket preflight. Start with scan or markets list|get when the selector is missing, otherwise start with quote. Mention polymarket preflight only after the user is on an explicit Polymarket execution path with concrete trade inputs.');
    }
    if (requestLower.includes('mirror') && (requestLower.includes('plan') || requestLower.includes('dry-run') || requestLower.includes('preflight') || requestLower.includes('going live'))) {
      instructions.push('For mirror planning or preflight answers, explicitly use the words validation or validate in the answer itself and name agent market validate before any deploy or go step, even if you still need the user to choose a market.');
      instructions.push('For mirror planning or preflight answers, explicitly state that live deployment requires at least two independent public resolution sources from different hosts, and that Polymarket, Gamma, and CLOB URLs are discovery inputs rather than valid resolution sources.');
    }
    if (requestLower.includes('profile') && (requestLower.includes('ready') || requestLower.includes('readiness') || requestLower.includes('usable') || requestLower.includes('live'))) {
      instructions.push('For profile readiness or go/no-go answers, explicitly include the phrases profile list and profile explain in the answer. Say profile list first and profile explain for the exact command or mode context. Do not use profile get or profile validate as the main readiness answer.');
      instructions.push('Start with Pandora discovery on this flow: use a Pandora-specific tool search or profile list before answering.');
    }
    if (requestLower.includes('mcp') || requestLower.includes('http gateway') || requestLower.includes('stdio')) {
      instructions.push('When comparing local stdio MCP and hosted HTTP, explicitly name the hosted bootstrap read-only scopes capabilities:read,contracts:read,help:read,schema:read,operations:read.');
    }
    if (requestLower.includes('watch') || requestLower.includes('risk')) {
      instructions.push('For monitoring answers, explicitly mention watch plus risk show or explain, and keep the path read-only before any trade workflow.');
    }
    if (requestLower.includes('sports') && requestLower.includes('provider')) {
      instructions.push('For sports onboarding without provider setup, explicitly route through sports books list first and say provider configuration is required before schedule or event discovery.');
    }
    if (requestLower.includes('close out') || requestLower.includes('closeout') || requestLower.includes('claim') || requestLower.includes('positions') || requestLower.includes('portfolio')) {
      instructions.push('For closeout answers, explicitly mention portfolio, history, and claim or mirror close, and say inspect or dry-run first before any mutation. If the wallet is missing, ask for it only after stating that inspection-first sequence.');
    }
    if (
      requestLower.includes('sdk')
      || requestLower.includes('agent product')
      || requestLower.includes('integrating pandora')
      || requestLower.includes('building my own agent')
    ) {
      instructions.push('For builder-surface comparison answers, explicitly map MCP to agent tool use, CLI to terminal scripts or operators, and SDK to embedding Pandora into application code.');
      instructions.push('Use bootstrap as the cold-start contract for all three surfaces, keep local stdio versus hosted HTTP ownership explicit, and do not imply that the SDK bypasses transport, policy, or runtime readiness checks.');
    }
  }
  if (kind === 'trigger-should-not') {
    instructions.push('If this request is unrelated to Pandora, do not call Pandora tools.');
  }
  instructions.push('Respond in plain text.');
  return `${request}\n\n${instructions.join('\n')}`;
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function parseClaudeStream(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
  const toolUses = [];
  const assistantText = [];
  const rawEvents = [];
  let initEvent = null;
  let finalResult = null;

  for (const line of lines) {
    const event = safeJsonParse(line);
    if (!event || typeof event !== 'object') continue;
    rawEvents.push(event);
    if (event.type === 'system' && event.subtype === 'init') {
      initEvent = event;
      continue;
    }
    if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
      for (const chunk of event.message.content) {
        if (!chunk || typeof chunk !== 'object') continue;
        if (chunk.type === 'text' && typeof chunk.text === 'string') {
          assistantText.push(chunk.text);
        }
        if (chunk.type === 'tool_use') {
          toolUses.push({
            id: chunk.id || null,
            name: chunk.name || null,
            input: chunk.input || null,
          });
        }
      }
      continue;
    }
    if (event.type === 'result') {
      finalResult = event;
    }
  }

  const permissionDenials = Array.isArray(finalResult && finalResult.permission_denials)
    ? finalResult.permission_denials.map((denial) => ({
        toolName: denial && denial.tool_name ? denial.tool_name : null,
        toolUseId: denial && denial.tool_use_id ? denial.tool_use_id : null,
      }))
    : [];
  const pandoraToolUses = toolUses.filter((entry) => String(entry && entry.name || '').startsWith('mcp__pandora__'));

  return {
    initEvent,
    finalResult,
    responseText: String((finalResult && finalResult.result) || assistantText.join('\n')).trim(),
    toolUses,
    pandoraToolUses,
    permissionDenials,
    eventCount: rawEvents.length,
  };
}

function main() {
  const stdin = readStdin().trim();
  if (!stdin) {
    throw new Error('Expected scenario JSON on stdin.');
  }
  const payload = JSON.parse(stdin);
  const defaultBundleRoot = path.resolve(process.cwd(), 'dist', 'pandora-skill');
  const bundleRoot = String(process.env.PANDORA_SKILL_BUNDLE_ROOT || defaultBundleRoot).trim();
  if (!fs.existsSync(bundleRoot)) {
    throw new Error(`Skill bundle root does not exist: ${bundleRoot}`);
  }

  const claudePath = String(process.env.PANDORA_CLAUDE_BIN || 'claude').trim();
  const model = String(process.env.PANDORA_SKILL_EXECUTOR_MODEL || '').trim();
  const effort = String(process.env.PANDORA_SKILL_EXECUTOR_EFFORT || 'low').trim();
  const permissionMode = String(
    process.env.PANDORA_SKILL_EXECUTOR_PERMISSION_MODE
      || (process.env.PANDORA_SKILL_EXECUTOR_SKIP_PERMISSIONS === '0' ? 'dontAsk' : 'bypassPermissions'),
  ).trim();
  const skipPermissions = process.env.PANDORA_SKILL_EXECUTOR_SKIP_PERMISSIONS !== '0';
  const prompt = buildScenarioPrompt(payload);
  const args = [
    '-p',
    '--verbose',
    '--output-format', 'stream-json',
    '--permission-mode', permissionMode,
    '--plugin-dir', bundleRoot,
  ];
  if (skipPermissions) {
    args.push('--dangerously-skip-permissions');
  }
  if (model) {
    args.push('--model', model);
  }
  if (effort) {
    args.push('--effort', effort);
  }

  const result = spawnSync(claudePath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    input: prompt,
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }
  if ((result.status === null ? 1 : result.status) !== 0) {
    process.stderr.write(String(result.stderr || result.stdout || '').trim());
    process.exit(result.status === null ? 1 : result.status);
  }

  const stdout = String(result.stdout || '').trim();
  if (!stdout) {
    throw new Error('Claude executor returned empty stdout.');
  }
  const parsed = parseClaudeStream(stdout);
  const finalResult = parsed.finalResult || {};
  const response = {
    responseText: parsed.responseText,
    sessionId: finalResult.session_id || (parsed.initEvent && parsed.initEvent.session_id) || null,
    durationMs: finalResult.duration_ms || null,
    totalCostUsd: finalResult.total_cost_usd || null,
    modelUsage: finalResult.modelUsage || null,
    stopReason: finalResult.stop_reason || null,
    permissionMode: parsed.initEvent && parsed.initEvent.permissionMode ? parsed.initEvent.permissionMode : permissionMode,
    toolUses: parsed.toolUses,
    pandoraToolUses: parsed.pandoraToolUses,
    permissionDenials: parsed.permissionDenials,
    eventCount: parsed.eventCount,
    raw: finalResult,
  };
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

try {
  if (require.main === module) {
    main();
  }
} catch (error) {
  if (require.main === module) {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exit(1);
  }
}

module.exports = {
  buildScenarioPrompt,
  parseClaudeStream,
};
