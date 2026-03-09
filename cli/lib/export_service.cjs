const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXPORT_SCHEMA_VERSION = '1.1.0';

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
  'date',
  'market',
  'action',
  'amount',
  'price',
  'gas_usd',
  'realized_pnl',
  'classification',
  'venue',
  'source',
  'code',
  'message',
  'mode',
  'verdict',
  'strategy_hash',
  'state_file',
  'idempotency_key',
  'ledger_leg_type',
  'asset',
  'quantity',
  'notional_usdc',
  'fee_usdc',
  'gas_native',
  'realized_pnl_usdc',
  'unrealized_pnl_usdc',
  'lp_fee_income_usdc',
  'impermanent_loss_usdc',
  'funding_flow_usdc',
  'bridge_flow_usdc',
  'block_number',
  'nonce',
  'provenance_json',
  'components_json',
  'details_json',
];

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function firstDefined() {
  for (const value of arguments) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isLikelyTxHash(value) {
  const text = String(value || '').trim();
  return /^0x[a-z0-9]{4,}$/i.test(text);
}

function toJsonStringOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function pickExportTxHash(item, details) {
  const direct = firstDefined(item.txHash, details.txHash, details.transactionHash);
  if (isLikelyTxHash(direct)) return String(direct).trim();
  const fallback = firstDefined(item.transactionRef, details.transactionRef);
  return isLikelyTxHash(fallback) ? String(fallback).trim() : null;
}

function toTimestampMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (Math.abs(numeric) >= 1e12) return Math.trunc(numeric);
    return Math.trunc(numeric * 1000);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function toUnixBoundaryMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.abs(numeric) >= 1e12 ? Math.trunc(numeric) : Math.trunc(numeric * 1000);
}

function toExportRows(historyPayload) {
  const wallet = historyPayload.wallet;
  const strategyHash = historyPayload.strategyHash || null;
  const stateFile = historyPayload.stateFile || null;
  return (historyPayload.items || []).map((item) => {
    const details = item && item.details && typeof item.details === 'object' ? item.details : {};
    return {
      date: toReplayDate(item.timestamp),
      market: firstDefined(item.marketAddress, item.selector && item.selector.pandoraMarketAddress),
      action: firstDefined(item.tradeType, item.action, item.classification, item.verdict, details.legType),
      amount: firstDefined(
        item.collateralAmountUsdc,
        item.amount,
        details.amountUsdc,
        details.notionalUsdc,
        item.actual && item.actual.spendUsdc,
      ),
      price: firstDefined(item.entryPriceUsdcPerToken, item.price, details.price),
      gas_usd: firstDefined(item.feeAmountUsdc, details.gasUsdc, details.gasCostUsdc),
      realized_pnl: firstDefined(item.pnlRealizedApproxUsdc, details.realizedPnlUsdc),
      timestamp: item.timestamp,
      chain_id: item.chainId,
      wallet: firstDefined(item.wallet, wallet),
      market_address: firstDefined(item.marketAddress, item.selector && item.selector.pandoraMarketAddress),
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
      tx_hash: pickExportTxHash(item, details),
      classification: item.classification || null,
      venue: item.venue || null,
      source: item.source || null,
      code: item.code || null,
      message: item.message || null,
      mode: firstDefined(item.mode, details.mode),
      verdict: item.verdict || null,
      strategy_hash: firstDefined(item.strategyHash, strategyHash),
      state_file: firstDefined(item.stateFile, stateFile),
      idempotency_key: firstDefined(item.idempotencyKey, details.idempotencyKey),
      ledger_leg_type: firstDefined(item.legType, details.legType, details.ledgerLegType),
      asset: firstDefined(item.asset, details.asset, details.assetSymbol, details.symbol),
      quantity: toNumberOrNull(firstDefined(item.quantity, details.quantity, details.tokenAmount)),
      notional_usdc: toNumberOrNull(firstDefined(item.notionalUsdc, details.notionalUsdc, details.amountUsdc)),
      fee_usdc: toNumberOrNull(firstDefined(item.feeUsdc, details.feeUsdc, details.feesUsdc)),
      gas_native: toNumberOrNull(firstDefined(item.gasNative, details.gasNative)),
      realized_pnl_usdc: toNumberOrNull(firstDefined(item.realizedPnlUsdc, details.realizedPnlUsdc)),
      unrealized_pnl_usdc: toNumberOrNull(firstDefined(item.unrealizedPnlUsdc, details.unrealizedPnlUsdc)),
      lp_fee_income_usdc: toNumberOrNull(firstDefined(item.lpFeeIncomeUsdc, details.lpFeeIncomeUsdc)),
      impermanent_loss_usdc: toNumberOrNull(firstDefined(item.impermanentLossUsdc, details.impermanentLossUsdc)),
      funding_flow_usdc: toNumberOrNull(firstDefined(item.fundingFlowUsdc, details.fundingFlowUsdc)),
      bridge_flow_usdc: toNumberOrNull(firstDefined(item.bridgeFlowUsdc, details.bridgeFlowUsdc)),
      block_number: toNumberOrNull(firstDefined(item.blockNumber, details.blockNumber)),
      nonce: toNumberOrNull(firstDefined(item.nonce, details.nonce)),
      provenance_json: toJsonStringOrNull(firstDefined(item.provenance, details.provenance)),
      components_json: toJsonStringOrNull(firstDefined(item.components, details.components)),
      details_json: toJsonStringOrNull(Object.keys(details).length ? details : null),
    };
  });
}

function toReplayDate(timestampSeconds) {
  const timestampMs = toTimestampMs(timestampSeconds);
  if (timestampMs === null) return null;
  return new Date(timestampMs).toISOString().slice(0, 10);
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
    const ts = toTimestampMs(row.timestamp);
    if (ts === null) return false;
    const fromMs = toUnixBoundaryMs(from);
    const toMs = toUnixBoundaryMs(to);
    if (fromMs !== null && ts < fromMs) return false;
    if (toMs !== null && ts > toMs) return false;
    return true;
  });
}

function maybeWriteOutput(content, outPath) {
  if (!outPath) return null;
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmpPath = `${resolved}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, { mode: 0o600 });
    fs.renameSync(tmpPath, resolved);
    try {
      fs.chmodSync(resolved, 0o600);
    } catch {
      // best-effort hardening on platforms that ignore/limit chmod
    }
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // best-effort temp cleanup
    }
    throw err;
  }
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
