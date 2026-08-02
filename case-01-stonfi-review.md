# case-01 — STON.fi DEX core v2: invariant test suite

**Target:** ston-fi/dex-core-v2 @ commit af0a955cc835af9697cd383e201fefcbe1a6a87e
**Size:** ~4,355 LoC FunC (upstream license: GPL-3.0)
**Tooling:** Blueprint, @ton/sandbox, Jest, local TVM emulation

## What was built

A property-based invariant suite executed against the pinned commit. Production contracts are driven through randomized call sequences in a local TVM sandbox; after each sequence, encoded protocol invariants are checked against a reference model.

## Results (actual run output in artifacts/)

- 5/5 suites passing, 6/6 tests
- Weighted-stableswap: 250 randomized cases, 0 divergences from the reference model
- Weighted constant-product: 214 cases
- Constant-sum: 250 cases, 0 divergences

A passing result means the encoded invariants held under the tested sequences. It is not a security claim.

## Reproduce

1. Clone upstream: ston-fi/dex-core-v2, checkout commit af0a955cc835af9697cd383e201fefcbe1a6a87e
2. Copy the `.spec.ts` files from artifacts/stonfi-v2-invariant-tests/ into the upstream `tests/` directory
3. Run: `npx jest --runInBand --verbose <spec files>`

Full artifacts, specs, and captured run output: artifacts/stonfi-v2-invariant-tests/
