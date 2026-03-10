# Legacy Launchers

This document covers `pandora launch` and `pandora clone-bet`.

These commands are legacy script wrappers. They remain supported, but they are not the canonical mirror/operator flow and they are not exposed over MCP.

## Important differences from mirror flows
- They stream script output directly rather than returning the full JSON command envelope model.
- They still expose `--target-timestamp-offset-hours`.
- That offset flag is a script-layer legacy behavior and does **not** define mirror timing.
- For mirror deployment, use `mirror plan|deploy|go` and follow [`mirror-operations.md`](./mirror-operations.md).

## Current launcher split
- `pandora launch` is the generic legacy market creator. It supports both `--market-type amm` and `--market-type parimutuel`.
- `pandora launch --market-type parimutuel` is the supported way to create a pari-mutuel market today, including `--curve-flattener` and `--curve-offset`.
- `pandora clone-bet` is pari-mutuel-only. It creates a pari-mutuel market and immediately places an initial `buy` bet. It does not support AMM creation.

## PollCategory mapping
| Name | Id |
| --- | --- |
| Politics | `0` |
| Sports | `1` |
| Finance | `2` |
| Crypto | `3` |
| Culture | `4` |
| Technology | `5` |
| Science | `6` |
| Entertainment | `7` |
| Health | `8` |
| Environment | `9` |
| Other | `10` |

## Clone-and-bet example (sports)
```bash
pandora clone-bet \
  --dry-run \
  --market-type parimutuel \
  --question "Will Arsenal FC win against Chelsea FC on 2026-03-01?" \
  --rules "Resolves YES if Arsenal FC wins in regulation time on March 1, 2026. Resolves NO for draw/Chelsea win. If cancelled, postponed beyond 48h, abandoned, or unresolved by official competition records, resolves NO." \
  --sources "https://www.premierleague.com" "https://www.bbc.com/sport/football" \
  --target-timestamp 1772323200 \
  --target-timestamp-offset-hours 1 \
  --arbiter 0x0D7B957C47Da86c2968dc52111D633D42cb7a5F7 \
  --category Sports \
  --liquidity 10 \
  --curve-flattener 7 \
  --curve-offset 30000 \
  --bet-usd 10 \
  --bet-on yes
```

## Launch example (crypto AMM)
```bash
pandora launch \
  --dry-run \
  --market-type amm \
  --question "Will BTC close above $100k by end of 2026?" \
  --rules "Resolves YES if BTC/USD closes above 100000 on 2026-12-31 per listed public sources. Resolves NO otherwise. If data feed is cancelled, postponed, abandoned, or unresolved by 2027-01-02, resolves NO." \
  --sources "https://coinmarketcap.com/currencies/bitcoin/" "https://www.coingecko.com/en/coins/bitcoin" \
  --target-timestamp 1798675200 \
  --target-timestamp-offset-hours 1 \
  --category Crypto \
  --liquidity 100 \
  --fee-tier 3000 \
  --distribution-yes 600000000 \
  --distribution-no 400000000
```

## Launch example (sports pari-mutuel)
```bash
pandora launch \
  --dry-run \
  --market-type parimutuel \
  --question "Will Arsenal FC win against Chelsea FC on 2026-03-01?" \
  --rules "Resolves YES if Arsenal FC wins in regulation time on March 1, 2026. Resolves NO for draw/Chelsea win. If cancelled, postponed beyond 48h, abandoned, or unresolved by official competition records, resolves NO." \
  --sources "https://www.premierleague.com" "https://www.bbc.com/sport/football" \
  --target-timestamp 1772323200 \
  --target-timestamp-offset-hours 1 \
  --category Sports \
  --liquidity 10 \
  --distribution-yes 500000000 \
  --distribution-no 500000000 \
  --curve-flattener 7 \
  --curve-offset 30000
```

## Notes
- `--category Sports` maps to `PollCategory.Sports` (`1`).
- `--category Crypto` maps to `PollCategory.Crypto` (`3`).
- `clone-bet` accepts `--market-type parimutuel` for explicitness, but rejects `amm`.
- Use `--allow-duplicate` only when intentionally bypassing duplicate-question checks.
- If `pandora` is not linked globally, use `node cli/pandora.cjs launch ...` or `node cli/pandora.cjs clone-bet ...`.
- For script implementation detail, see [`references/creation-script.md`](../../references/creation-script.md).
