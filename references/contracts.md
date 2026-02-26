# Pandora Market Contracts Reference (Provided Mainnet Deployment)

Use these addresses as source-of-truth unless explicitly reconfigured.

Deployment:

- Network: `Pandora Mainnet`
- Deployer: `0x972405d0009DdD8906a36109B069E4D7d02E5801`
- PredictionOracle (Factory): `0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442`
- PredictionPoll (Implementation): `0xC49c177736107fD8351ed6564136B9ADbE5B1eC3`
- Operators added: `10`

MarketFactory stack:

- MarketFactory: `0xaB120F1FD31FB1EC39893B75d80a3822b1Cd8d0c`
- OutcomeToken (Implementation): `0x15AF9A6cE764a7D2b6913e09494350893436Ab3d`
- PredictionAMM (Implementation): `0x7D45D4835001347B31B722Fb830fc1D9336F09f4`
- PredictionPariMutuel (Implementation): `0x5CaF2D85f17A8f3b57918d54c8B138Cacac014BD`

Deployment configuration:

- Oracle: `0x259308E7d8557e4Ba192De1aB8Cf7e0E21896442`
- Initial collateral (USDC): `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- Platform treasury: `0x8789F22a0456FEddaf9074FF4cEE55E4122095f0`
- Protocol fee rate: `20000` (`2%`)

Indexer:

- Public indexer URL: `https://pandoraindexer.up.railway.app/`

Notes:

- Keep `scripts/.env` aligned with these addresses before market creation/execution.
- `resolve` and `lp` remain ABI-gated in CLI until verified ABI signatures/events are wired and tested.
