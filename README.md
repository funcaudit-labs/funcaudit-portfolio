TON / FunC Smart-Contract Security Review — Portfolio
Independent smart-contract security research on the TON blockchain (FunC / Tolk)
by Ruslan Ibraev. This repository documents self-directed security reviews
performed to demonstrate methodology and depth. Reviews are independent and not
commissioned; all work was done against public source code and testnet / local
TVM emulation.

Selected findings
TON DeFi staking protocol — liveness / availability issue
(coordinated disclosure in progress).
Identified a share-accounting edge case in a staking contract where a specific
unstake sequence can drive the pool into an unusable state, blocking further
stakes. Reported privately to the project. Full technical details and PoC are
withheld pending remediation and are available on request.
Case study — STON.fi dex-core-v2 (independent review)
Target: STON.fi DEX core v2 (public source, GPL-3.0)
Scope reviewed: router, pool, vault, lp_account, jetton receipt path,
stableswap / weighted-stableswap math, funcbox fixed-point library
Size: ~4,355 LoC FunC
Environment: testnet, local TVM emulation
Methodology
Full manual read of the in-scope contracts against a TON-specific threat model.
Local reproduction harness using Blueprint + @ton/sandbox (in-process TVM),
plus a PoC harness.
Invariant checks on the AMM math (swap invariant, LP-share accounting,
rounding direction of the fixed-point library).
Message-flow analysis of the async / bounce model and sender-address gating.
Threat model (top vectors checked)
Fake-jetton / spoofed transfer_notification (token-identity confusion)
Bounce / state-desync between wallet and pool
Economic invariant / share-price / LP-supply manipulation
Access control / privilege escalation on payout paths
Async race conditions across message hops
Result
No critical- or high-severity vulnerabilities were identified within the
reviewed scope. Key defensive properties confirmed during review:

Payout paths (pay_to / pay_vault / vault_pay_to) are gated by deterministic
sender-address reconstruction — pool/vault spoofing is not possible.
Token identity is keyed by the sender address of the jetton wallet, so a
fake jetton is isolated to a differently-keyed (empty) pool and cannot
release real assets.
Fixed-point math rounds against the user where it matters, preventing
rounding-based value extraction at scale.
Design / centralization properties (admin-configurable parameters) were noted
as documented assumptions, not vulnerabilities, as they are out of a standard
bug-bounty scope.

Tooling used
FunC / Tolk toolchain, Blueprint, @ton/sandbox, custom PoC test harness,
manual invariant analysis, Slither / Aderyn / Mythril where applicable.

Services
Independent security review of TON / FunC / Tolk smart contracts:
jetton, vault, vesting, minter, staking, and DEX-style contracts.
Fixed-price reviews of individual contracts available.

Contact: iruslan1203@gmail.com
