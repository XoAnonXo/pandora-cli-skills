const DEFAULT_INDEXER_TIMEOUT_MS = 12_000;

class IndexerClientError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'IndexerClientError';
    this.code = code;
    this.details = details;
  }
}

function normalizePageResult(rawPage) {
  if (!rawPage || typeof rawPage !== 'object') {
    return { items: [], pageInfo: null };
  }

  const items = Array.isArray(rawPage.items) ? rawPage.items : [];
  const pageInfo = rawPage.pageInfo && typeof rawPage.pageInfo === 'object' ? rawPage.pageInfo : null;
  return { items, pageInfo };
}

function buildGraphqlListQuery(queryName, filterType, fields) {
  const fieldList = fields.join('\n      ');
  return `query List($where: ${filterType}, $orderBy: String, $orderDirection: String, $before: String, $after: String, $limit: Int) {
  ${queryName}(where: $where, orderBy: $orderBy, orderDirection: $orderDirection, before: $before, after: $after, limit: $limit) {
    items {
      ${fieldList}
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
  }
}`;
}

function buildGraphqlGetQuery(queryName, fields) {
  const fieldList = fields.join('\n      ');
  return `query Get($id: String!) {
  ${queryName}(id: $id) {
    ${fieldList}
  }
}`;
}

async function graphqlRequest(indexerUrl, query, variables, timeoutMs = DEFAULT_INDEXER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(indexerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new IndexerClientError('INDEXER_TIMEOUT', `Indexer request timed out after ${timeoutMs}ms.`);
    }
    throw new IndexerClientError('INDEXER_REQUEST_FAILED', `Indexer request failed: ${err && err.message ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new IndexerClientError('INDEXER_HTTP_ERROR', `Indexer returned HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new IndexerClientError('INDEXER_INVALID_JSON', 'Indexer returned invalid JSON.');
  }

  if (payload.errors && payload.errors.length) {
    const first = payload.errors[0];
    throw new IndexerClientError('INDEXER_GRAPHQL_ERROR', first && first.message ? first.message : 'Indexer GraphQL error.', {
      errors: payload.errors,
    });
  }

  if (!payload.data || typeof payload.data !== 'object') {
    throw new IndexerClientError('INDEXER_MALFORMED_RESPONSE', 'Indexer response missing data object.');
  }

  return payload.data;
}

function createIndexerClient(indexerUrl, timeoutMs = DEFAULT_INDEXER_TIMEOUT_MS) {
  return {
    async list({ queryName, filterType, fields, variables }) {
      const query = buildGraphqlListQuery(queryName, filterType, fields);
      const data = await graphqlRequest(indexerUrl, query, variables || {}, timeoutMs);
      return normalizePageResult(data[queryName]);
    },

    async getById({ queryName, fields, id }) {
      const query = buildGraphqlGetQuery(queryName, fields);
      const data = await graphqlRequest(indexerUrl, query, { id }, timeoutMs);
      return data[queryName] || null;
    },

    async getManyByIds({ queryName, fields, ids }) {
      const unique = Array.from(new Set((ids || []).map((value) => String(value).trim()).filter(Boolean)));
      const query = buildGraphqlGetQuery(queryName, fields);
      const out = new Map();
      await Promise.all(
        unique.map(async (id) => {
          const data = await graphqlRequest(indexerUrl, query, { id }, timeoutMs);
          out.set(id, data[queryName] || null);
        }),
      );
      return out;
    },

    request: (query, variables) => graphqlRequest(indexerUrl, query, variables, timeoutMs),
  };
}

module.exports = {
  DEFAULT_INDEXER_TIMEOUT_MS,
  IndexerClientError,
  buildGraphqlListQuery,
  buildGraphqlGetQuery,
  graphqlRequest,
  normalizePageResult,
  createIndexerClient,
};
