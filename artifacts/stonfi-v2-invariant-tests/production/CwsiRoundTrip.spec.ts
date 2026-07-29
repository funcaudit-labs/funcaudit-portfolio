// SPDX-License-Identifier: GPL-3.0-only
import { compile } from '@ton/blueprint';
import { beginCell, contractAddress, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import 'dotenv/config';
import { preprocBuildContractsLocal } from '../helpers/helpers';
import { Pool } from '../wrappers/Pool';
import { SLIM_CONFIG_LEGACY } from '../libs/src/test-helpers';

const ONE = 10n ** 18n;

function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('Weighted-stableswap round-trip', () => {
    let bc: Blockchain, code: any, lpW: any, lpA: any;
    let router: SandboxContract<TreasuryContract>,
        user: SandboxContract<TreasuryContract>,
        w0a: SandboxContract<TreasuryContract>,
        w1a: SandboxContract<TreasuryContract>,
        pf: SandboxContract<TreasuryContract>;

    // manual storage build: is_locked=0 + valid amp/rate/w0 (wrapper hardcodes lock=1 and w0=0)
    const cwsiData = (r0: bigint, r1: bigint, amp: bigint, rate: bigint, w0: bigint, lpFee: bigint, tsl: bigint) =>
        beginCell()
            .storeUint(0, 1)
            .storeCoins(r0)
            .storeCoins(r1)
            .storeCoins(tsl)
            .storeCoins(0n)
            .storeCoins(0n)
            .storeAddress(pf.address)
            .storeUint(lpFee, 16)
            .storeUint(0n, 16)
            .storeRef(
                beginCell() // w_params
                    .storeUint(amp, 128)
                    .storeUint(rate, 128)
                    .storeUint(w0, 128)
                    .storeAddress(null) // rate_setter = addr_none
                    .endCell(),
            )
            .storeRef(
                beginCell() // static
                    .storeAddress(router.address)
                    .storeAddress(w0a.address)
                    .storeAddress(w1a.address)
                    .storeRef(lpW)
                    .storeRef(lpA)
                    .endCell(),
            )
            .endCell();

    const mkPool = (r0: bigint, r1: bigint, amp: bigint, rate: bigint, w0: bigint, lpFee: bigint, tsl: bigint) => {
        const init = { code, data: cwsiData(r0, r1, amp, rate, w0, lpFee, tsl) };
        return bc.openContract(new Pool(contractAddress(0, init), init));
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
            dexType: 'weighted_stableswap',
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
        w0a = await bc.treasury('w0a');
        w1a = await bc.treasury('w1a');
        pf = await bc.treasury('pf');
    });

    it('round-trip cannot profit', async () => {
        const rng = mulberry32(3131);
        const N = 250;
        const rand = (a: number, b: number) => BigInt(Math.floor(a + rng() * (b - a)));
        let tested = 0;
        for (let i = 0; i < N; i++) {
            const r0 = rand(1_000_000_000, 1_000_000_000_000);
            const factor = 0.6 + rng() * 0.9; // r1 within ~0.6x..1.5x of r0
            let r1 = BigInt(Math.max(1_000_000_000, Math.floor(Number(r0) * factor)));
            const rate = (r0 * ONE) / r1; // mimic on-chain init rate
            const wsel = rng();
            const w0 = wsel < 0.7 ? ONE / 2n : wsel < 0.85 ? (4n * ONE) / 10n : (6n * ONE) / 10n;
            const amp = ONE;
            const cap = r0 / 10n > 1n ? r0 / 10n : 2n;
            const amountIn = rand(1, Number(cap));
            const lpFee = rng() < 0.5 ? 0n : rand(0, 51);
            const pool = mkPool(r0, r1, amp, rate, w0, lpFee, BigInt(1_000_000_000 + i));
            await doSwap(pool, true, amountIn);
            let d1: any;
            try {
                d1 = await pool.getPoolData();
            } catch {
                continue;
            }
            const d1L = BigInt(d1.leftReserve),
                d1R = BigInt(d1.rightReserve);
            if (d1L === r0 && d1R === r1) continue; // refund / no-convergence
            const out1 = r1 - d1R;
            if (out1 < 1n || out1 > d1R / 4n) continue;
            await doSwap(pool, false, out1);
            let d2: any;
            try {
                d2 = await pool.getPoolData();
            } catch {
                continue;
            }
            const d2L = BigInt(d2.leftReserve),
                d2R = BigInt(d2.rightReserve);
            if (d2L === d1L && d2R === d1R) continue;
            const out2 = d1L - d2L;
            tested++;
            if (out2 > amountIn)
                throw new Error(
                    `CWSI ROUND-TRIP PROFIT i=${i} r0=${r0} r1=${r1} w0=${w0} rate=${rate} lpFee=${lpFee} in=${amountIn} out1=${out1} out2=${out2} profit=${out2 - amountIn}`,
                );
        }
        console.log(`CWSI round-trip: ${tested} effective cases, no profit`);
        expect(tested).toBeGreaterThan(30);
    }, 180000);
});
