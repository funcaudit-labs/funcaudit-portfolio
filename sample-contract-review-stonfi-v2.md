# Contract Review & Documentation — Sample Deliverable

**Subject:** STON.fi v2 — Router / Pool / LP Account (FunC, TON)
**Reference commit:** `af0a955cc835af9697cd383e201fefcbe1a6a87e`
**Prepared by:** FuncAudit Labs
**Contact:** cpljoshrayperson@yandex.ru
**Document type:** Work sample

---

## 0. What this document is

This is a **public work sample**. It was produced against publicly available source code, without any engagement, request, or communication with the STON.fi team. It contains no confidential information, no undisclosed vulnerability, and no claim that the reviewed code is unsafe.

It exists to show one thing: **what a client receives when they hire us to read their contracts.**

A paid engagement produces the same document structure against *your* codebase, at *your* commit, with your naming, your invariants, and a runnable test suite committed to a repository you own.

### How to read this document

| If you are | Read |
|---|---|
| An engineer joining the team | §2, §3, §4 — the system model |
| A protocol lead | §1, §6, §7 — scope, results, observations |
| An auditor scoping work | §5, §6, §9 — invariants, coverage, gaps |
| An integrator | §3, §8 — message flows and documentation gaps |

---

## 1. Scope and methodology

### 1.1 In scope

| Component | Role | Approx. size |
|---|---|---|
| Router | Entry point; owns jetton wallets; routes swap payloads to pools | FunC |
| Pool | Holds reserves; computes swap output; mints/burns LP jettons | FunC |
| LP Account | Per-user staging contract for two-sided liquidity provision | FunC |
| Vault | Accrues and releases referral / protocol fees | FunC |

Total reviewed surface: **≈ 4 355 lines of FunC** at the reference commit.

### 1.2 Out of scope

- Off-chain infrastructure (indexer, API, frontend)
- Jetton master contracts of traded assets
- Governance / multisig key management
- Economic modelling of fee parameters

### 1.3 Method

The review is **differential and property-based**, not checklist-based. Three passes:

1. **Read pass.** Every message handler traced by hand from entry to terminal state. Output: the message-flow maps in §3 and the state model in §4.
2. **Model pass.** A reference implementation of the pricing and liquidity math written independently in TypeScript, from the specification the code implies — not by transcribing the code.
3. **Differential pass.** Randomised inputs driven through both the on-chain contract (in a local TON emulator) and the reference model. Every divergence is a finding: either the code is wrong, or our understanding of it is wrong. Both outcomes are valuable — the second is exactly how documentation gaps surface.

This method is deliberately chosen because it **cannot produce a report full of generic filler.** A property either holds under thousands of random inputs or it does not.

---

## 2. System overview

```
        user jetton wallet
                │  transfer(forward_payload = swap)
                ▼
        ┌───────────────┐
        │    Router     │  owns a jetton wallet per supported asset
        └───────┬───────┘
                │  swap request (derived pool address)
                ▼
        ┌───────────────┐        ┌───────────────┐
        │     Pool      │◄──────►│  LP Account   │  staging for two-sided deposits
        └───────┬───────┘        └───────────────┘
                │  pay_to
                ▼
        ┌───────────────┐
        │     Vault     │  referral / protocol fee accrual
        └───────────────┘
```

**Key architectural property:** the Router is the only contract that holds jetton wallets. Pools never custody jettons directly — they hold *accounting* reserves, and the Router moves the actual tokens. Every reasoning step about solvency therefore has two halves: pool bookkeeping and router custody. They must agree. §5 states this as an explicit invariant.

### 2.1 Pool types

Two pricing curves are supported:

| Curve | Used for | Pricing rule |
|---|---|---|
| Constant product | volatile pairs | `x · y = k` |
| Stable | pegged pairs | amplified invariant, solved iteratively |

The two curves share the same message interface and the same LP accounting. They differ only in the output computation. This is a good design decision and worth stating explicitly, because it means **the invariant suite for one curve is structurally reusable for the other** — which is what §6 does.

---

## 3. Message flow maps

### 3.1 Swap

```
1. user → jetton wallet          transfer(amount, to = Router, forward_payload)
2. jetton wallet → Router        transfer_notification(amount, sender, payload)
3. Router                        parse payload → resolve pool address
4. Router → Pool                 swap(sender, amount_in, min_out, referral)
5. Pool                          compute out; update reserves; accrue fees
6. Pool → Router                 pay_to(receiver, amount_out) | pay_to(sender, refund)
7. Router → jetton wallet        transfer(amount_out, to = receiver)
```

**Failure branches that must be traced (and were):**

| Branch | Trigger | Terminal state |
|---|---|---|
| Slippage | `amount_out < min_out` | full refund of `amount_in` to sender |
| Unknown pool | payload names a non-existent pool | refund |
| Empty reserves | pool has no liquidity on one side | refund |
| Insufficient gas | forward TON below handler cost | bounce; funds remain at Router |

The fourth row is the one integrators most often get wrong, and §8 flags it as a documentation gap.

### 3.2 Provide liquidity

```
1. user → Router                 transfer of asset A (payload: provide_lp)
2. Router → LP Account           add A to staged balance
3. user → Router                 transfer of asset B (payload: provide_lp)
4. Router → LP Account           add B to staged balance
5. LP Account → Pool             both sides present → mint request
6. Pool                          compute LP amount; update reserves
7. Pool → LP jetton wallet       mint LP tokens to provider
```

**Observation:** the LP Account is a *stateful waiting room*. A user who deposits one side and never the other leaves value parked in a contract that requires an explicit refund action. This is correct behaviour, but it is behaviour an integrator must know about. See §7, observation 4.

### 3.3 Burn / withdraw

```
1. user → LP jetton wallet       burn(amount)
2. LP wallet → Pool              burn_notification(amount, owner)
3. Pool                          compute pro-rata amounts; reduce reserves
4. Pool → Router                 pay_to(owner, amount_A, amount_B)
5. Router → jetton wallets       two transfers
```

---

## 4. State model

### 4.1 Pool storage

| Field | Meaning | Mutated by |
|---|---|---|
| `reserve0`, `reserve1` | accounting reserves per side | swap, mint, burn |
| `total_supply_lp` | outstanding LP jettons | mint, burn |
| `lp_fee`, `protocol_fee`, `ref_fee` | fee split in basis points | admin |
| `collected_token0_protocol_fee`, `collected_token1_protocol_fee` | accrued, unwithdrawn | swap, fee withdrawal |
| `router_address` | trusted caller | immutable after init |
| pool-type parameters | amplification etc. | admin (stable pools) |

### 4.2 Trust boundaries

| Caller | May invoke | Enforcement |
|---|---|---|
| Router | swap, mint, burn notification | sender address equality check |
| LP Account | mint request | derived-address check |
| Admin | fee parameters, fee withdrawal | stored admin address |
| Anyone | get-methods | read-only |

Every handler in the pool begins by asserting the caller. This is the single most important structural property of the contract, and it holds uniformly across handlers at the reference commit.

---

## 5. Invariants

These are the properties the test suite asserts. Each is stated formally, then in plain language.

### I1 — Constant product does not decrease

```
k_after ≥ k_before        where k = reserve0 · reserve1
```

A swap may only increase `k` (by the fee retained in the pool). If any input sequence decreases `k`, value is leaking out of the pool.

### I2 — Output is bounded by reserves

```
amount_out < reserve_out        for all inputs
```

No swap may drain a side completely. The asymptotic form of the curve guarantees this; the test asserts it against integer arithmetic, where the guarantee is not automatic.

### I3 — Round-trip loss is bounded and non-negative

```
0 ≤ amount_in − roundtrip_out ≤ 2 · fee(amount_in) + ε_rounding
```

Swapping A→B and immediately B→A must lose money — exactly the fee, plus at most a rounding unit. Losing *less* than the fee means the fee can be bypassed. Losing dramatically more means a rounding bug that silently taxes users.

### I4 — LP accounting is monotone and pro-rata

```
mint:  Δtotal_supply / total_supply  ≈  Δreserve / reserve      (both sides)
burn:  amount_out_i = total_supply_share · reserve_i            (rounded down)
```

A depositor cannot mint LP tokens worth more than the assets deposited; a burner cannot withdraw more than the pro-rata share.

### I5 — Rounding always favours the pool

```
for every division in the value path: result is rounded down for the user
```

The direction of every truncation must be consistent. A single division rounded the wrong way is the classic drain-by-a-thousand-cuts bug.

### I6 — Accounting reserves never exceed custody

```
Σ pool.reserve_i  ≤  balance of Router's jetton wallet for asset i
```

Because the Router custodies and the Pool accounts, these two numbers must never diverge in the pool's favour.

### I7 — Stable curve converges

```
the iterative solver terminates within its iteration cap for all admissible inputs
```

And when it hits the cap, the returned value is conservative rather than optimistic.

---

## 6. Test suite

The suite is delivered as a runnable repository, not as screenshots.

| Spec file | Property | Cases | Result |
|---|---|---|---|
| `Invariant.spec.ts` | I1, I2, I5 — constant product | 5 | 5 / 5 pass |
| `StableInvariant.spec.ts` | I1, I7 — stable curve | 6 | 6 / 6 pass |
| `WcpiRoundTrip.spec.ts` | I3 — volatile round trip | 250 randomised | 0 divergences |
| `CwsiRoundTrip.spec.ts` | I3 — stable round trip | 214 randomised | 0 divergences |
| `CsiRoundTrip.spec.ts` | I3, I4 — cross-curve consistency | 250 randomised | 0 divergences |

**Total: 725 executed cases, 0 divergences between the on-chain implementation and the independently written reference model.**

### 6.1 What "0 divergences" means — and what it does not

It means: across 725 randomised inputs, the contract's pricing and liquidity arithmetic matched a model written independently from the specification. That is meaningful evidence that the math is implemented as intended.

It does **not** mean the contract is free of vulnerabilities. Property testing covers the properties you state. It says nothing about properties you did not think to state. §9 lists exactly what remains uncovered.

We state this plainly because a report that claims more than it proves is worth less than no report.

### 6.2 Reproducing

```bash
git clone <delivered-repo>
cd <delivered-repo>
npm install
npx blueprint test
```

Seeded runs are deterministic. Case counts and seeds are recorded in the spec headers so any result in the table above can be reproduced exactly.

---

## 7. Observations

None of the following is an exploitable vulnerability. Each is a place where the code's behaviour is correct but **undocumented, surprising, or fragile under future change** — which is where most incidents actually originate.

### Observation 1 — Rounding direction is correct but implicit

**Severity:** Informational

The value path contains several integer divisions. All of them round in the pool's favour at the reference commit, satisfying I5. However, the direction is a consequence of FunC's default division semantics rather than an explicit, commented choice.

**Why it matters:** a future refactor that switches a helper to a rounding-aware division, or reorders a multiply-then-divide into divide-then-multiply, silently breaks I5. There is no test in the upstream repository that would catch it.

**Recommendation:** annotate each division in the value path with its intended rounding direction, and keep I5 as a permanent regression test.

### Observation 2 — Tiny-reserve regime produces zero-output swaps

**Severity:** Informational

When a pool's output reserve is very small relative to the input, integer truncation can produce `amount_out = 0`. The contract handles this correctly: the swap fails slippage and the user is refunded.

**Why it matters:** integrators that treat "transaction succeeded" as "swap executed" will misreport. The refund path and the success path are both non-bounced transactions.

**Recommendation:** document the zero-output regime in integration docs; recommend that integrators assert on the resulting transfer, not on transaction success.

### Observation 3 — Fee parameter bounds are enforced but unstated

**Severity:** Low

Admin-settable fee parameters have upper bounds enforced at write time. The bounds are correct, but they are not documented anywhere outside the source, and the behaviour of the pool at the extreme admissible values is not obviously intended (at maximum fee the effective price impact for small trades exceeds what the UI would display).

**Recommendation:** publish the admissible ranges; add a test asserting pool behaviour at both bounds.

### Observation 4 — LP Account is a stateful waiting room

**Severity:** Informational

A one-sided deposit remains staged in the LP Account until the second side arrives or the user explicitly refunds. There is no timeout.

**Why it matters:** funds parked in a staging contract look like lost funds to a user and like unexplained TVL to an indexer.

**Recommendation:** document the refund path prominently; surface staged balances in the API.

### Observation 5 — Gas assumptions are load-bearing and undocumented

**Severity:** Low

Several handlers assume a minimum forwarded TON amount to complete their downstream message chain. When the assumption is violated, the chain halts mid-way and funds rest at the Router until swept.

**Why it matters:** this is the single most common integration failure mode on TON, and the required amounts are only discoverable by reading the code.

**Recommendation:** publish per-operation minimum gas figures and keep them in a test that fails when handler cost grows.

### Observation 6 — Upgrade and admin surface is not enumerated for integrators

**Severity:** Low

An integrator cannot determine from public documentation which parameters an admin may change at runtime, and which are fixed at deployment.

**Recommendation:** publish a table of mutable parameters, their bounds, and the address authorised to change each.

---

## 8. Documentation gaps found while reading

These are not findings about the code. They are the questions we had to answer by reading the source, which a new engineer or integrator will also have to answer.

| # | Question that required reading source | Where it should live |
|---|---|---|
| 1 | What is the exact refund behaviour on slippage failure? | integration docs |
| 2 | What are the minimum forwarded TON amounts per operation? | integration docs |
| 3 | How is a pool address derived from an asset pair? | integration docs |
| 4 | What happens to a one-sided liquidity deposit? | user docs + API |
| 5 | Which parameters are admin-mutable, and within what bounds? | protocol docs |
| 6 | How does the stable solver behave at its iteration cap? | technical spec |

**This table is the highest-value output of the entire engagement.** Every row is a support ticket that will be filed, a wrong integration that will be shipped, or an onboarding week that will be spent — until it is written down.

---

## 9. What this review does not cover

Stated explicitly, because a review whose limits are hidden is a liability:

- **Economic / game-theoretic attacks.** Oracle manipulation, MEV extraction, and fee-parameter griefing are out of scope.
- **Formal verification.** Property testing is empirical evidence, not proof.
- **Off-chain components.** Indexer, API, and frontend are not reviewed.
- **Governance and key management.** Who holds the admin key, and under what process, is not assessed.
- **Deployed bytecode.** The review is against source at a named commit; it does not verify that deployed code matches.
- **Properties not stated in §5.** The suite tests what it states. Nothing more.

---

## 10. What a paid engagement delivers

| Deliverable | Form |
|---|---|
| This document, against your codebase | Markdown + PDF |
| Message-flow maps for every handler | diagrams in-repo |
| Formal invariant statements | §5-style, reviewed with your team |
| Runnable property test suite | committed to a repo you own |
| Documentation-gap table | prioritised |
| One revision round | after your team reads it |

**Turnaround:** 5–10 working days depending on codebase size.
**Engagement size:** typically 3 000–12 000 lines of contract source.
**Terms:** 50% on start, 50% on delivery. USDT.

The test suite is the part clients keep. The document explains the system once; the suite keeps it true after every future commit.

---

*Prepared against public source code. No engagement with, endorsement by, or communication with the STON.fi team is implied. No undisclosed security issue is contained in this document.*
