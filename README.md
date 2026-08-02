# funcaudit-labs

**Invariant test suites for TON smart contracts. You run them. You see the results.**

We build property-based invariant test suites for FunC/Tolk contracts using Blueprint and @ton/sandbox, run them against your pinned commit, and hand you the suite plus the actual run output. No trust required: every claim we make is a command you can re-run yourself.

## What you get — $600–900, 5 days

- An invariant test suite written against your contract (Blueprint + @ton/sandbox)
- Commit-pinned scope: the suite targets one specific commit of your repository
- Reproduction instructions: the exact commands we used, from clone to run
- The actual run output from our environment
- The suite is yours: it lands in your repo and keeps working after the engagement

Typical properties we encode: balance conservation, total-supply integrity, monotonic counters, access-control boundaries, jetton identity consistency across async bounces.

## What this is not

This is not a security audit and not a sign-off. We do not claim your contract is safe, and we do not issue audit reports. We deliver testing infrastructure: executable checks of the properties your contract must preserve. A passing suite means the invariants held under the tested sequences — nothing more, nothing less.

Firms quote $5,000+ for a simple token audit and $20,000–60,000 for a DeFi protocol. We do less, and we charge an order of magnitude less.

## How an engagement works

1. You point us at a repository and a commit.
2. We confirm scope in writing: which contracts, which properties, fixed price.
3. 50% prepayment in USDT. Day 5: you receive the suite, run instructions, and our run output. 50% on delivery.

## Public artifacts

**case-01 — STON.fi DEX core v2 invariant suite**
Suite executed against ston-fi/dex-core-v2 at commit af0a955 (~4,355 LoC FunC, GPL-3.0 upstream).
Result: 5/5 suites passing, 6/6 tests, 250 weighted-stableswap cases and 250 constant-sum cases, 0 divergences from the reference model.
Artifacts and full run output: artifacts/stonfi-v2-invariant-tests/

**case-02 — EVAA protocol review notes**
Structured review of evaafi/contracts v8 at commit ef9ea25 (~10,800 LoC FunC), the snapshot previously audited by Trail of Bits. Focus on out-of-audit-scope surfaces: price parsing, admin flows, liquidation branches. Factual observations only, no vulnerability claims.
See case-02-evaa-review.md.

## Contact

Email: cpljoshrayperson@yandex.ru
Scoped quote within 24 hours.
