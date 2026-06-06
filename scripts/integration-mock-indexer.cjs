'use strict';

const http = require('http');

const MARKET_ADDRESS = process.argv[2] || '0x0000000000000000000000000000000000000000';
const POLL_ADDRESS = process.argv[3] || '0x0000000000000000000000000000000000000000';
const CLOSE_TS = process.argv[4] || String(Math.floor(Date.now() / 1000) + 86400 * 30);
const QUESTION = process.argv[5] || 'Integration test market';

const market = {
  id: MARKET_ADDRESS.toLowerCase(),
  chainId: 11155111,
  chainName: 'sepolia',
  pollAddress: POLL_ADDRESS.toLowerCase(),
  creator: '0xD71ECa4D1c36C086898A005e7d0A42E8f54D54B6',
  marketType: 'amm',
  marketCloseTimestamp: CLOSE_TS,
  totalVolume: '50000',
  currentTvl: '100000',
  yesChance: '0.50',
  reserveYes: '500000000',
  reserveNo: '500000000',
  createdAt: String(Math.floor(Date.now() / 1000)),
};

const poll = {
  id: POLL_ADDRESS.toLowerCase(),
  chainId: 11155111,
  chainName: 'sepolia',
  creator: '0xD71ECa4D1c36C086898A005e7d0A42E8f54D54B6',
  question: QUESTION,
  status: 0,
  category: 1,
  deadlineEpoch: Number(CLOSE_TS),
  createdAt: Math.floor(Date.now() / 1000),
  createdTxHash: '0x0000000000000000000000000000000000000000000000000000000000000001',
  rules: `YES: ${QUESTION} resolves YES.\nNO: Otherwise.`,
  sources: '["https://github.com","https://etherscan.io"]',
};

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let bodyJson = {};
    try { bodyJson = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
    const query = bodyJson.query || '';
    const variables = bodyJson.variables || {};

    let response = { data: {} };

    if (query.includes('marketss(')) {
      response = { data: { marketss: { items: [market], totalCount: 1 } } };
    } else if (query.includes('markets(id:')) {
      const found = variables.id === market.id ? market : null;
      response = { data: { markets: found } };
    } else if (query.includes('pollss(')) {
      response = { data: { pollss: { items: [poll], totalCount: 1 } } };
    } else if (query.includes('polls(id:')) {
      const found = variables.id === poll.id ? poll : null;
      response = { data: { polls: found } };
    } else if (query.includes('liquidityEventss(')) {
      response = { data: { liquidityEventss: { items: [], totalCount: 0 } } };
    } else if (query.includes('tradess(')) {
      response = { data: { tradess: { items: [], totalCount: 0 } } };
    } else if (query.includes('marketUserss(')) {
      response = { data: { marketUserss: { items: [], totalCount: 0 } } };
    } else if (query.includes('winningss(')) {
      response = { data: { winningss: { items: [], totalCount: 0 } } };
    }

    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(response));
  });
});

server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  console.log(`MOCK_INDEXER_URL=http://127.0.0.1:${addr.port}`);
});
