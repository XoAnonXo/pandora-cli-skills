'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  sendWebhookNotifications,
} = require('../../cli/lib/webhook_service.cjs');
const {
  startJsonHttpServer,
} = require('../helpers/cli_runner.cjs');

test('sendWebhookNotifications retries transient generic webhook failures and signs each delivery attempt', async () => {
  let attempts = 0;
  const server = await startJsonHttpServer((request) => {
    attempts += 1;
    if (attempts < 3) {
      return {
        status: 502,
        body: { ok: false },
      };
    }
    return {
      status: 200,
      body: { ok: true },
    };
  });

  try {
    const report = await sendWebhookNotifications(
      {
        webhookUrl: `${server.url}/hook`,
        webhookSecret: 'phase7-secret',
        webhookRetries: 2,
        webhookTimeoutMs: 250,
      },
      {
        event: 'pandora.operation.lifecycle',
        message: 'mirror sync completed',
        operationId: 'op-webhook-retry',
      },
    );

    assert.equal(report.count, 1);
    assert.equal(report.successCount, 1);
    assert.equal(report.failureCount, 0);
    assert.equal(report.results[0].target, 'generic');
    assert.equal(report.results[0].ok, true);
    assert.equal(report.results[0].attempt, 3);
    assert.equal(server.requests.length, 3);

    const firstBody = server.requests[0].bodyText;
    const expectedSignature = crypto.createHmac('sha256', 'phase7-secret').update(firstBody).digest('hex');
    for (const request of server.requests) {
      assert.equal(request.url, '/hook');
      assert.equal(request.headers['x-pandora-signature'], expectedSignature);
      assert.equal(request.bodyText, firstBody);
    }
  } finally {
    await server.close();
  }
});

test('sendWebhookNotifications returns per-target success and failure accounting for mixed webhook outcomes', async () => {
  const server = await startJsonHttpServer((request) => {
    if (request.url === '/generic') {
      return {
        status: 200,
        body: { ok: true },
      };
    }
    if (request.url === '/discord') {
      return {
        status: 500,
        body: { ok: false },
      };
    }
    return {
      status: 404,
      body: { ok: false },
    };
  });

  try {
    const report = await sendWebhookNotifications(
      {
        webhookUrl: `${server.url}/generic`,
        discordWebhookUrl: `${server.url}/discord`,
        webhookRetries: 0,
        webhookTimeoutMs: 250,
      },
      {
        message: 'policy recommendation updated',
        operationId: 'op-webhook-mixed',
      },
    );

    assert.equal(report.count, 2);
    assert.equal(report.successCount, 1);
    assert.equal(report.failureCount, 1);

    const byTarget = new Map(report.results.map((result) => [result.target, result]));
    assert.equal(byTarget.get('generic').ok, true);
    assert.equal(byTarget.get('generic').attempt, 1);
    assert.equal(byTarget.get('generic').url, `${server.url}/generic`);
    assert.equal(byTarget.get('discord').ok, false);
    assert.equal(byTarget.get('discord').attempt, 1);
    assert.match(byTarget.get('discord').error, /http 500/i);
    assert.equal(byTarget.get('discord').url, `${server.url}/discord`);
  } finally {
    await server.close();
  }
});
