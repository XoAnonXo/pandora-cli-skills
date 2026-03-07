const POLL_CATEGORY_IDS = Object.freeze({
  Politics: 0,
  Sports: 1,
  Finance: 2,
  Crypto: 3,
  Culture: 4,
  Technology: 5,
  Science: 6,
  Entertainment: 7,
  Health: 8,
  Environment: 9,
  Other: 10,
});

const POLL_CATEGORY_BY_NAME = Object.freeze({
  politics: 0,
  sports: 1,
  finance: 2,
  crypto: 3,
  culture: 4,
  technology: 5,
  science: 6,
  entertainment: 7,
  health: 8,
  environment: 9,
  other: 10,
});

const POLL_CATEGORY_NAME_LIST = Object.freeze(Object.keys(POLL_CATEGORY_IDS));
const DEFAULT_SPORTS_POLL_CATEGORY = POLL_CATEGORY_IDS.Sports;

const POLL_CATEGORY_HELP_TEXT = POLL_CATEGORY_NAME_LIST.join('|');
const POLL_CATEGORY_ENUM_TEXT = POLL_CATEGORY_NAME_LIST.map((name, index) => `${name}=${index}`).join(', ');

function normalizePollCategoryKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, '');
}

function getPollCategoryId(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 10) {
    return numeric;
  }

  const normalized = normalizePollCategoryKey(text);
  for (const [name, id] of Object.entries(POLL_CATEGORY_BY_NAME)) {
    if (normalizePollCategoryKey(name) === normalized) {
      return id;
    }
  }
  return null;
}

function parsePollCategoryFlag(value, flagName, CliError, parseInteger = null) {
  const text = String(value || '').trim();
  if (!text) {
    throw new CliError('INVALID_FLAG_VALUE', `${flagName} requires a value.`);
  }

  const categoryId = getPollCategoryId(text);
  if (categoryId !== null) return categoryId;

  if (typeof parseInteger === 'function') {
    const parsed = parseInteger(text, flagName);
    if (parsed >= 0 && parsed <= 10) return parsed;
  }

  throw new CliError(
    'INVALID_FLAG_VALUE',
    `${flagName} must be one of ${POLL_CATEGORY_HELP_TEXT} or an integer between 0 and 10.`,
  );
}

function parsePollCategory(value, options = {}) {
  class PollCategoryError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  return parsePollCategoryFlag(
    value,
    options.flagName || '--category',
    PollCategoryError,
    typeof options.parseInteger === 'function' ? options.parseInteger : null,
  );
}

const exported = {
  POLL_CATEGORY_IDS,
  POLL_CATEGORY_BY_NAME,
  POLL_CATEGORY_NAME_LIST,
  POLL_CATEGORY_HELP_TEXT,
  POLL_CATEGORY_ENUM_TEXT,
  DEFAULT_SPORTS_POLL_CATEGORY,
  getPollCategoryId,
  parsePollCategoryFlag,
  parsePollCategoryInput: parsePollCategoryFlag,
  parsePollCategory,
};

module.exports = exported;
module.exports.default = exported;
