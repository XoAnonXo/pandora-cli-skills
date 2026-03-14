# Mirror Live Repro Checklist

Use this checklist for field issues that are still plausible but not yet fixed by code changes.

## Capture before treating as a product bug

- exact command line, including `--rebalance-route`, `--rebalance-route-fallback`, `--flashbots-relay-url`, `--flashbots-auth-key`, `--no-hedge`, and risk caps
- `mirror status --with-live` output for the affected strategy
- daemon JSONL log excerpt around the failure
- RPC endpoint list used for Ethereum and Polygon
- tx hashes, nonce, and whether the route was `public`, `flashbots-private`, or `flashbots-bundle`

## Tx-drop investigation

- record whether the drop happened on deploy, rebalance approval, or rebalance trade
- capture wallet nonce before and after the failed attempt
- capture provider responses, replacement-underpriced messages, and whether a later retry used the same nonce
- record whether `--rebalance-route-fallback public` was enabled

## Flashbots relay 403 investigation

- capture relay URL, HTTP status, and any relay response body
- record whether the failing path was `auto`, `flashbots-private`, or `flashbots-bundle`
- record whether the path needed approval
- confirm whether the failure happened before submission or after a bundle/private tx hash was returned

## Gamma sports search investigation

- capture the exact search terms, tag filters, date window, and any explicit slug or league hints
- capture the raw Gamma response rows that looked unrelated
- record whether the same market resolved correctly by direct slug lookup

## Exit criterion

Do not mark tx-drop, relay-403, or Gamma-search issues as fixed until a captured repro is either:

- explained by current route/runtime behavior with evidence, or
- reproduced and covered by a focused regression test.
