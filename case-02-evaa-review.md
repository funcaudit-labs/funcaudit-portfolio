# EVAA Protocol — Security Review (Case Study #2)

**Target:** EVAA Protocol — first lending protocol on TON (FunC)
**Repo:** github.com/evaafi/contracts (BUSL-1.1)
**Version:** v8, commit ef9ea250b674e1d96c52ce12c4552778e10322b9 (matches Trail of Bits audited snapshot)
**Prior audits:** Trail of Bits (v8, Aug 2025), Quantstamp (v6)
**Scope:** Line-by-line review of the core value flow (storage, interest-rate math, oracle integration, supply/withdraw, liquidation). ~10,800 LoC total in the repo.
**Result:** No exploitable vulnerabilities found in reviewed scope — consistent with a doubly-audited codebase.

## Methodology
1. Reconstructed data model: principal <-> present value via sRate/bRate (present = principal * index / 1e12).
2. Analyzed rounding direction across all monetary ops (supply, borrow, withdraw, liquidation).
3. Reviewed the async master<->user state machine (TON-specific race / double-spend surface).
4. Formulated concrete exploit hypotheses and falsified them against the code.

## Invariants verified
- supply/borrow rounding favors protocol (debt rounds up, deposit rounds down) — OK
- principal serialization: pack/unpack bit-widths consistent (int64), no truncation in reviewed paths — OK
- Pyth oracle: price>0, staleness (now > ts + ttl) and feed->asset mapping validated. Pyth signature/merkle verification is treated as a trusted external dependency and was NOT re-audited here.
- supply/withdraw: state lock, revert-on-fail, health gate before withdraw — OK
- liquidation health check delegated to user SC; code substitution impossible (address derived from BLANK_CODE) — OK
- liquidation cap cascade (min_collateral, collateral_present, "too much", bad-debt) — over-liquidation closed
- concurrent liquidations serialized on user SC; delta reverts commute — robust
- fake-sender checks present in all async branches — OK

## Key vector analyzed: liquidation rounding-seam
Hypothesis: asymmetric rounding (collateral up / debt down) lets a liquidator extract slightly more value than repaid, repeatable => reserve drain.
Finding: EVAA rounds strictly in the protocol's favor — get_collateral_quote floors collateral (muldiv + integer divisions), collateral_reward = min(quote, present, max_not_too_much), while debt is repaid on the full liquidatable_amount. When a cap triggers, the liquidator overpays rather than profits. Hypothesis falsified.

## Informational: "protocol gift"
protocol_gift = transferred_amount - liquidatable_amount. Overpayment by a liquidator (sending more loan token than the borrower's debt) is retained by the protocol ("Free assets for the protocol"). Not attacker-exploitable; a footgun for integrators, who should compute the exact repay amount client-side.

## Out of scope (not reviewed in this pass)
- Pyth signature / merkle-proof verification internals (parse_pyth_price_data) — treated as trusted dependency.
- Admin, upgrade and governance paths (master-admin.fc, upgrade handling, set-supervisor).
- Master get-methods and the insufficient-liquidity branch of master-liquidate.fc.
- Reward-index accrual details (user_rewards tracking indexes).
- Off-chain components: SDK, liquidator bot, price-relayer infrastructure.

## Conclusion
Rounding is consistently conservative, the async state machine is race/replay resistant, and trust in the oracle and user contracts is correctly bounded by cryptographic address derivation. Value of this review lies in the confirmed rigor of the model and a methodology applicable to any FunC lending protocol.
