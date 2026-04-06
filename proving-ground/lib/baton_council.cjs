const { callMinimaxChat } = require('./minimax_client.cjs');
const {
  createFingerprint,
  normalizeText,
} = require('./baton_common.cjs');

const DEFAULT_REVIEWER_ROLES = Object.freeze([
  'correctness',
  'determinism',
  'safety',
  'performance',
  'simplicity',
  'goal-fit',
]);

const VETO_ROLES = new Set(['correctness', 'determinism', 'safety']);

function buildReviewerSystemPrompt(role) {
  return [
    'You are one member of the Pandora CLI review council.',
    'Return JSON only.',
    `Your role is ${role}.`,
    'Review the proposal before any code is applied.',
    'Only judge the proposal packet you were given.',
    'Use verdict accept, revise, or reject.',
    'Only use reject when the proposal should not be applied as written.',
    'Only use revise when the direction is useful but the proposal needs repair.',
    'Always include concrete blockers or evidence when present.',
  ].join(' ');
}

function buildReviewerUserPrompt(packet, role) {
  return JSON.stringify({
    role,
    reviewPacket: packet,
    returnShape: {
      reviewerId: `${role}-reviewer`,
      role,
      verdict: 'accept | revise | reject',
      confidence: 0.75,
      blockers: ['list blockers or leave empty'],
      evidence: ['short concrete reasons'],
      lowSignal: false,
      duplicateOf: null,
    },
  }, null, 2);
}

function extractFirstJsonObject(text) {
  const trimmed = normalizeText(text);
  if (!trimmed) {
    throw new Error('Review response was empty');
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }
  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Review response did not contain JSON');
  }
  return trimmed.slice(firstBrace, lastBrace + 1);
}

function normalizeStringList(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((entry) => normalizeText(entry)).filter(Boolean);
}

function parseReviewerDecision(text, role) {
  const payload = JSON.parse(extractFirstJsonObject(text));
  const verdict = normalizeText(payload.verdict).toLowerCase();
  if (!['accept', 'revise', 'reject'].includes(verdict)) {
    throw new Error(`Invalid council verdict for ${role}: ${payload.verdict}`);
  }
  return {
    reviewerId: normalizeText(payload.reviewerId) || `${role}-reviewer`,
    role,
    verdict,
    confidence: Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : 0,
    blockers: normalizeStringList(payload.blockers),
    evidence: normalizeStringList(payload.evidence),
    lowSignal: payload.lowSignal === true,
    duplicateOf: normalizeText(payload.duplicateOf) || null,
  };
}

function buildReviewPacket(options) {
  return {
    fingerprint: createFingerprint({
      proposal: options.proposal,
      baseline: options.baseline,
      section: {
        id: options.section.id,
        title: options.section.title,
        focusFiles: options.section.focusFiles,
      },
      priorDecision: options.priorDecision || null,
      promptVersion: options.promptVersion || 'baton-v1',
    }),
    laneId: options.laneId,
    attemptIndex: options.attemptIndex,
    proposal: options.proposal,
    touchedFiles: Array.isArray(options.proposal && options.proposal.targetFiles)
      ? options.proposal.targetFiles.slice()
      : [],
    baseline: options.baseline,
    laneContext: {
      sectionId: options.section.id,
      title: options.section.title,
      description: options.section.description,
      commandPrefixes: options.section.commandPrefixes,
      focusFiles: options.section.focusFiles,
      previousHandoff: options.previousHandoff || null,
    },
    priorDecision: options.priorDecision || null,
    promptVersion: options.promptVersion || 'baton-v1',
  };
}

async function runReviewer(options) {
  if (typeof options.reviewLoader === 'function') {
    return options.reviewLoader(options);
  }
  const response = await callMinimaxChat({
    ...options.modelConfig,
    systemPrompt: buildReviewerSystemPrompt(options.role),
    userPrompt: buildReviewerUserPrompt(options.packet, options.role),
    temperature: 0.1,
  });
  return parseReviewerDecision(response.text, options.role);
}

function aggregateCouncilDecision(reviews, councilConfig = {}) {
  const acceptCount = reviews.filter((review) => review.verdict === 'accept' && !review.lowSignal).length;
  const reviseCount = reviews.filter((review) => review.verdict === 'revise' && !review.lowSignal).length;
  const rejectCount = reviews.filter((review) => review.verdict === 'reject' && !review.lowSignal).length;
  const lowSignalCount = reviews.filter((review) => review.lowSignal).length;
  const quorum = Math.max(1, Number(councilConfig.quorum) || 4);
  const hardBlockers = reviews.filter((review) => (
    review.verdict === 'reject'
    && VETO_ROLES.has(review.role)
  ));
  const duplicateOnly = reviews.every((review) => review.lowSignal === true || review.duplicateOf);
  let outcome = 'revise';
  if (duplicateOnly || hardBlockers.length > 0 || rejectCount >= 2) {
    outcome = 'reject';
  } else if (acceptCount >= quorum) {
    outcome = 'accept';
  } else if (reviseCount > 0) {
    outcome = 'revise';
  } else if (acceptCount === 0) {
    outcome = 'reject';
  }
  return {
    outcome,
    acceptCount,
    reviseCount,
    rejectCount,
    lowSignalCount,
    vetoCount: hardBlockers.length,
    blockers: reviews.flatMap((review) => review.blockers),
    evidence: reviews.flatMap((review) => review.evidence),
  };
}

async function reviewProposalWithCouncil(options) {
  const packet = buildReviewPacket(options);
  const syntheticDecision = options.syntheticDecision;
  if (syntheticDecision && Array.isArray(syntheticDecision.reviews)) {
    const reviews = syntheticDecision.reviews.map((review, index) => ({
      reviewerId: normalizeText(review.reviewerId) || `${DEFAULT_REVIEWER_ROLES[index] || 'reviewer'}-reviewer`,
      role: normalizeText(review.role) || DEFAULT_REVIEWER_ROLES[index] || 'correctness',
      verdict: normalizeText(review.verdict).toLowerCase() || 'revise',
      confidence: Number.isFinite(Number(review.confidence)) ? Number(review.confidence) : 1,
      blockers: normalizeStringList(review.blockers),
      evidence: normalizeStringList(review.evidence),
      lowSignal: review.lowSignal === true,
      duplicateOf: normalizeText(review.duplicateOf) || null,
    }));
    return {
      packet,
      reviews,
      decision: aggregateCouncilDecision(reviews, options.councilConfig),
      synthetic: true,
    };
  }

  const roles = Array.isArray(options.councilConfig && options.councilConfig.roles)
    && options.councilConfig.roles.length > 0
    ? options.councilConfig.roles
    : DEFAULT_REVIEWER_ROLES;
  const reviews = [];
  for (const role of roles) {
    const review = await runReviewer({
      role,
      packet,
      modelConfig: options.modelConfig,
      reviewLoader: options.reviewLoader,
    });
    reviews.push(review);
  }
  return {
    packet,
    reviews,
    decision: aggregateCouncilDecision(reviews, options.councilConfig),
    synthetic: false,
  };
}

module.exports = {
  DEFAULT_REVIEWER_ROLES,
  aggregateCouncilDecision,
  buildReviewPacket,
  parseReviewerDecision,
  reviewProposalWithCouncil,
};
