# STON.fi DEX v2 — invariant test artifacts

Independent TON/TVM security-testing artifacts by Ruslan Ibraev.

## Target

- Upstream: https://github.com/ston-fi/dex-core-v2
- Reviewed commit: `af0a955cc835af9697cd383e201fefcbe1a6a87e`
- Environment: TON Blueprint and `@ton/sandbox`

## Production-relevant suites

- `Invariant.spec.ts`: constant-product reserve deltas match the swap model and `k` does not decrease.
- `StableInvariant.spec.ts`: stableswap reserve deltas match the model, invariant `D` does not decrease, and zero-LP-fee round trips do not profit.
- `WcpiRoundTrip.spec.ts`: weighted constant-product round trips do not profit across varied weights.
- `CwsiRoundTrip.spec.ts`: weighted-stableswap round trips do not profit.

## Reference-only suite

- `CsiRoundTrip.spec.ts`: constant-sum round-trip check. Constant-sum is a reference implementation and is not presented as production scope.

## Last verified result

- Test suites: 5 passed / 5 total
- Tests: 6 passed / 6 total
- Weighted-stableswap: 250 effective cases, no profit
- Weighted constant-product: 214 effective cases, no profit
- Constant-sum reference: 250 effective cases, no profit
- Stableswap model divergences: 0 / 250

Passing tests establish coverage of the stated invariants; they do not prove that the protocol is vulnerability-free.

## Reproduction

1. Clone the upstream repository.
2. Check out commit `af0a955cc835af9697cd383e201fefcbe1a6a87e`.
3. Copy these `.spec.ts` files into its `tests/` directory.
4. Install the upstream dependencies.
5. Run the selected files with `npx jest --runInBand --verbose <files>`.

## License

The test files in this directory are published under GPL-3.0-only for compatibility with the upstream GPL-3.0 project. STON.fi source code is not redistributed here.
