# Pre-flight + Post-launch Checklist

## Pre-flight
- [ ] Wallet ETH balance > 0.02 + fees buffer
- [ ] USDC balance >= planned liquidity per market + 0.2% buffer
- [ ] Oracle/Factory addresses match runtime config
- [ ] `MarketFactory.oracle()` returns expected oracle
- [ ] Oracle fees fetched on-chain and match expected
- [ ] Poll impl bytecode exists (`extcodesize > 0`)
- [ ] Sources are reachable URLs / explicit docs pages
- [ ] Deadline in future and `targetTimestamp` set correctly

## Launch
- [ ] Poll tx includes `operatorGasFee + protocolFee` in msg.value
- [ ] USDC approval transaction successful
- [ ] Market tx mined and `MarketCreated`/`PariMutuelCreated` event captured
- [ ] Poll and market address saved in a ledger file
- [ ] Both tx hashes copied and verified on block explorer

## Post-launch
- [ ] Market appears in Pandora `useMarkets` feed
- [ ] Poll/status UI resolves to correct question/rules/sources
- [ ] Initial liquidity reflected in TVL
- [ ] Publish markdown/copy drafted with category + angle + hooks
