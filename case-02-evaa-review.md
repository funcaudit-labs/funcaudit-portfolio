# case-02 — EVAA protocol v8: review notes

**Target:** evaafi/contracts @ commit ef9ea250b674e1d96c52ce12c4552778e10322b9 (v8 — matches the Trail of Bits audited snapshot)
**Size:** ~10,800 LoC FunC (upstream license: BUSL-1.1)
**Prior audits:** Trail of Bits (v8, Aug 2025), Quantstamp (v6)
**Scope:** Core value flow — storage, interest-rate math, oracle integration, supply/withdraw, liquidation.
**Result:** No exploitable vulnerabilities found in reviewed scope — consistent with a doubly-audited codebase. These are review notes, not an audit.

## Methodology

1. Reconstructed the data model: principal <-> present value via sRate/bRate (present = principal * index / 1e12).
2. Analyzed rounding direction across all monetary ops (supply, borrow, withdraw, liquidation).
3. Reviewed the async master<->user state machine (TON-specific race / double-spend surface).
4. Formulated concrete exploit hypotheses and falsified them against the code.

## Properties verified in reviewed scope

- supply/borrow rounding favors the protocol (debt rounds up, deposit rounds down) — OK
- principal serialization: pack/unpack bit-widths consistent (int64), no truncation in reviewed paths — OK
- Pyth oracle: price > 0, staleness (now > ts + ttl) and feed->asset mapping validated. Pyth signature/merkle verification treated as a trusted external dependency, NOT re-audited here
- supply/withdraw: state lock, revert-on-fail, health gate before withdraw — OK
- liquidation health check delegated to user contract; code substitution impossible (address derived from BLANK_CODE) — OK
- liquidation cap cascade (min_collateral, collateral_present, "too much", bad-debt) — over-liquidation closed
- concurrent liquidations serialized on user contract; delta reverts commute — OK
- fake-sender checks present in all async branches — OK

## Key hypothesis tested: liquidation rounding-seam

Hypothesis: asymmetric rounding (collateral up / debt down) lets a liquidator extract slightly more value than repaid, repeatable => reserve drain.
Finding: EVAA rounds strictly in the protocol's favor — get_collateral_quote floors collateral, collateral_reward = min(quote, present, max_not_too_much), while debt is repaid on the full liquidatable_amount. When a cap triggers, the liquidator overpays rather than profits. Hypothesis falsified.

## Informational: "protocol gift"

protocol_gift = transferred_amount - liquidatable_amount. Overpayment by a liquidator (sending more loan token than the borrower's debt) is retained by the protocol. Not attacker-exploitable; a footgun for integrators, who should compute the exact repay amount client-side.

## Out of scope (not reviewed in this pass)

- Pyth signature / merkle-proof verification internals (parse_pyth_price_data) — trusted dependency
- Admin, upgrade and governance paths (master-admin.fc, upgrade handling, set-supervisor)
- Master get-methods and the insufficient-liquidity branch of master-liquidate.fc
- Reward-index accrual details (user_rewards tracking indexes)
- Off-chain components: SDK, liquidator bot, price-relayer infrastructure

## How this relates to our product

This pass — data-model reconstruction, rounding-direction analysis, async race surface mapping — is the same scoping work we do before writing an invariant suite for a lending contract. The hypotheses above are exactly the properties we encode as executable tests.
