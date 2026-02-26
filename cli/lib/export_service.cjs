const fs = require('fs');
const path = require('path');

const EXPORT_SCHEMA_VERSION = '1.0.0';

const CSV_COLUMNS = [
  'timestamp',
  'chain_id',
  'wallet',
  'market_address',
  'poll_address',
  'question',
  'side',
  'trade_type',
  'amount_in_usdc',
  'tokens',
  'entry_price',
  'mark_price',
  'current_value_usdc',
  'pnl_unrealized_approx_usdc',
  'pnl_realized_approx_usdc',
  'status',
  'tx_hash',
];

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toExportRows(historyPayload) {
  const wallet = historyPayload.wallet;
  return (historyPayload.items || []).map((item) => ({
    timestamp: item.timestamp,
    chain_id: item.chainId,
    wallet,
    market_address: item.marketAddress,
    poll_address: item.pollAddress,
    question: item.question,
    side: item.side,
    trade_type: item.tradeType,
    amount_in_usdc: item.collateralAmountUsdc,
    tokens: item.tokenAmount,
    entry_price: item.entryPriceUsdcPerToken,
    mark_price: item.markPriceUsdcPerToken,
    current_value_usdc: item.currentValueUsdc,
    pnl_unrealized_approx_usdc: item.pnlUnrealizedApproxUsdc,
    pnl_realized_approx_usdc: item.pnlRealizedApproxUsdc,
    status: item.status,
    tx_hash: item.txHash,
  }));
}

function toCsv(rows) {
  const header = CSV_COLUMNS.join(',');
  const body = rows
    .map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col])).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

function parseDateRangeFilter(rows, options) {
  let from = options.from;
  let to = options.to;

  if (options.year) {
    const yearStart = Date.UTC(options.year, 0, 1) / 1000;
    const yearEnd = Date.UTC(options.year + 1, 0, 1) / 1000 - 1;
    from = from === null || from === undefined ? yearStart : Math.max(from, yearStart);
    to = to === null || to === undefined ? yearEnd : Math.min(to, yearEnd);
  }

  return rows.filter((row) => {
    const ts = Number(row.timestamp);
    if (!Number.isFinite(ts)) return false;
    if (from !== null && from !== undefined && ts < from) return false;
    if (to !== null && to !== undefined && ts > to) return false;
    return true;
  });
}

function maybeWriteOutput(content, outPath) {
  if (!outPath) return null;
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
  return resolved;
}

function buildExportPayload(historyPayload, options) {
  const rows = parseDateRangeFilter(toExportRows(historyPayload), options);

  let content;
  if (options.format === 'csv') {
    content = toCsv(rows);
  } else {
    content = JSON.stringify(rows, null, 2);
  }

  const writtenPath = maybeWriteOutput(content, options.outPath);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    format: options.format,
    wallet: historyPayload.wallet,
    chainId: historyPayload.chainId,
    count: rows.length,
    filters: {
      year: options.year,
      from: options.from,
      to: options.to,
    },
    columns: CSV_COLUMNS,
    outPath: writtenPath,
    rows,
    content,
  };
}

module.exports = {
  EXPORT_SCHEMA_VERSION,
  CSV_COLUMNS,
  buildExportPayload,
};
