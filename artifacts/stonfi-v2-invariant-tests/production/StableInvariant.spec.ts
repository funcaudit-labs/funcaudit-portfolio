// SPDX-License-Identifier: GPL-3.0-only
import { compile } from '@ton/blueprint';
import { contractAddress, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import 'dotenv/config';
import { preprocBuildContractsLocal } from '../helpers/helpers';
import { PoolStable, stablePoolConfigToCell } from '../wrappers/Pool';
import { SLIM_CONFIG_LEGACY } from '../libs/src/test-helpers';

const FEE_DIVIDER = 10000n;
const absB = (x: bigint) => (x < 0n ? -x : x);
const divc = (a: bigint, b: bigint) => (a + b - 1n) / b;

function calcInvariant(amp: bigint, left: bigint, right: bigint): bigint {
    const sum = left + right;
    if (sum === 0n) return 0n;
    let inv = sum,
        prev = 0n;
    for (let k = 0; k < 255; k++) {
        let d_p = inv;
        d_p = (d_p * inv) / (left * 2n);
        d_p = (d_p * inv) / (right * 2n);
        prev = inv;
        const first = amp * sum + d_p * 2n;
        const second = (amp - 1n) * inv + d_p * 3n;
        if (second <= 0n) throw new Error('nc');
        inv = (first * inv) / second;
        if (absB(inv - prev) <= 1n) return inv;
    }
    throw new Error('nc');
}

function getOutBalance(amp: bigint, left: bigint, right: bigint, inv: bigint, side: boolean): bigint {
    let sum = left + right;
    let p_d = left * 2n;
    p_d = (p_d * right * 2n) / inv;
    sum = sum - (side ? right : left);
    const inv2 = inv * inv;
    const denomC = amp * p_d;
    if (denomC <= 0n) throw new Error('nc');
    const c = divc(inv2, denomC) * (side ? right : left);
    const b = sum + inv / amp;
    let tb = divc(inv2 + c, inv + b),
        prev = 0n;
    for (let k = 0; k < 255; k++) {
        prev = tb;
        const denom = tb * 2n + b - inv;
        if (denom <= 0n) throw new Error('nc');
        tb = divc(tb * tb + c, denom);
        if (absB(tb - prev) <= 1n) return tb;
    }
    throw new Error('nc');
}

function stableBaseOut(amp: bigint, r0: bigint, r1: bigint, side: boolean, amountIn: bigint, lpFee: bigint): bigint {
    const baseIn = (amountIn * (FEE_DIVIDER - lpFee)) / FEE_DIVIDER;
    const inv = calcInvariant(amp, r0, r1);
    const lb = side ? r0 + baseIn : r0;
    const rb = side ? r1 : r1 + baseIn;
    const finalOut = getOutBalance(amp, lb, rb, inv, side);
    const base = side ? r1 : r0;
    return base - finalOut - 1n;
}

function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('Stableswap invariant fuzz', () => {
    let bc: Blockchain, code: any;
    let router: SandboxContract<TreasuryContract>,
        user: SandboxContract<TreasuryContract>,
        w0: SandboxContract<TreasuryContract>,
        w1: SandboxContract<TreasuryContract>,
        pf: SandboxContract<TreasuryContract>;
    let lpW: any, lpA: any;

    const mkPool = (r0: bigint, r1: bigint, amp: bigint, lpFee: bigint, tsl: bigint) => {
        const cfg: any = {
            routerAddress: router.address,
            lpFee,
            protocolFee: 0n,
            protocolFeeAddress: pf.address,
            collectedLeftJettonProtocolFees: 0n,
            collectedRightJettonProtocolFees: 0n,
            leftReserve: r0,
            rightReserve: r1,
            leftWalletAddress: w0.address,
            rightWalletAddress: w1.address,
            totalSupplyLP: tsl,
            LPWalletCode: lpW,
            LPAccountCode: lpA,
            amp,
        };
        const data = stablePoolConfigToCell(cfg);
        const init = { code, data };
        return bc.openContract(new PoolStable(contractAddress(0, init), init));
    };

    const doSwap = async (pool: any, side: boolean, amt: bigint) =>
        pool.sendSwap(
            router.getSender(),
            {
                leftAmount: side ? amt : 0n,
                rightAmount: side ? 0n : amt,
                fromAddress: user.address,
                refAddress: router.address,
                refValue: 0,
                deadline: 4_000_000_000,
                minOut: 1n,
            } as any,
            toNano('1'),
        );

    beforeAll(async () => {
        preprocBuildContractsLocal({
            dexType: 'stableswap',
            defaultProtocolFee: null,
            defaultIsLocked: null,
            defaultLPFee: null,
        } as any);
        code = await compile('Pool');
        lpW = await compile('LPWallet');
        lpA = await compile('LPAccount');
        bc = await Blockchain.create({ config: SLIM_CONFIG_LEGACY });
        router = await bc.treasury('router');
        user = await bc.treasury('user');
        w0 = await bc.treasury('w0');
        w1 = await bc.treasury('w1');
        pf = await bc.treasury('pf');
    });

    it('A: reserve deltas match model & D never decreases', async () => {
        const rng = mulberry32(2027);
        const N = 250;
        const rand = (a: number, b: number) => BigInt(Math.floor(a + rng() * (b - a)));
        let diverge = 0;
        for (let i = 0; i < N; i++) {
            const r0 = rand(10_000, 1_000_000_000_000);
            const r1 = rand(10_000, 1_000_000_000_000);
            const amountIn = rand(1, 100_000_000_000);
            const lpFee = rand(0, 101);
            const amp = rand(1, 200_000);
            const side = rng() < 0.5;
            const pool = mkPool(r0, r1, amp, lpFee, BigInt(1_000_000_000 + i));
            let base: bigint | null = null,
                tsOk = false;
            try {
                base = stableBaseOut(amp, r0, r1, side, amountIn, lpFee);
                tsOk = true;
            } catch {
                tsOk = false;
            }
            await doSwap(pool, side, amountIn);
            let d: any;
            try {
                d = await pool.getPoolData();
            } catch (e) {
                throw new Error(
                    `crash i=${i} amp=${amp} r0=${r0} r1=${r1} in=${amountIn} side=${side} :: ${(e as Error).message}`,
                );
            }
            const g0 = BigInt(d.leftReserve),
                g1 = BigInt(d.rightReserve);
            const changed = g0 !== r0 || g1 !== r1;
            const ctx = `i=${i} amp=${amp} r0=${r0} r1=${r1} in=${amountIn} lpFee=${lpFee} side=${side} base=${base}`;
            if (changed) {
                if (!tsOk || base === null) throw new Error(`CONTRACT OK, MODEL nc ${ctx} got0=${g0} got1=${g1}`);
                const exp0 = side ? r0 + amountIn : r0 - base;
                const exp1 = side ? r1 - base : r1 + amountIn;
                if (g0 !== exp0 || g1 !== exp1)
                    throw new Error(`RESERVE MISMATCH ${ctx} exp0=${exp0} exp1=${exp1} got0=${g0} got1=${g1}`);
                let dOld = 0n,
                    dNew = 0n;
                try {
                    dOld = calcInvariant(amp, r0, r1);
                    dNew = calcInvariant(amp, g0, g1);
                } catch {
                    continue;
                }
                if (dNew < dOld) throw new Error(`D DECREASED ${ctx} Dold=${dOld} Dnew=${dNew}`);
            } else {
                if (tsOk && base !== null && base >= 1n && (side ? r1 - base : r0 - base) > 0n) diverge++;
            }
        }
        console.log(`A done. convergence divergences (contract refused a model-valid swap): ${diverge}/${N}`);
    }, 180000);

    it('B: round-trip cannot profit (lpFee=0)', async () => {
        const rng = mulberry32(9091);
        const N = 250;
        const rand = (a: number, b: number) => BigInt(Math.floor(a + rng() * (b - a)));
        for (let i = 0; i < N; i++) {
            const base = rand(1_000_000, 1_000_000_000_000);
            const r0 = base;
            const r1 = rng() < 0.5 ? base : rand(1_000_000, 1_000_000_000_000);
            const cap = r0 / 4n > 1n ? r0 / 4n : 2n;
            const amountIn = rand(1, Number(cap));
            const amp = rand(1, 200_000);
            const pool = mkPool(r0, r1, amp, 0n, BigInt(1_000_000_000 + i));
            await doSwap(pool, true, amountIn);
            let d1: any;
            try {
                d1 = await pool.getPoolData();
            } catch {
                continue;
            }
            const d1L = BigInt(d1.leftReserve),
                d1R = BigInt(d1.rightReserve);
            if (d1L === r0 && d1R === r1) continue; // refunded
            const out1 = r1 - d1R; // token1 to attacker
            if (out1 < 1n) continue;
            await doSwap(pool, false, out1);
            let d2: any;
            try {
                d2 = await pool.getPoolData();
            } catch {
                continue;
            }
            const d2L = BigInt(d2.leftReserve),
                d2R = BigInt(d2.rightReserve);
            if (d2L === d1L && d2R === d1R) continue; // refunded
            const out2 = d1L - d2L; // token0 back to attacker
            if (out2 > amountIn)
                throw new Error(
                    `ROUND-TRIP PROFIT i=${i} amp=${amp} r0=${r0} r1=${r1} in=${amountIn} out1=${out1} out2=${out2} profit=${out2 - amountIn}`,
                );
        }
    }, 180000);
});
