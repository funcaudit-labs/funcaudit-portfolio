// SPDX-License-Identifier: GPL-3.0-only
import { compile } from '@ton/blueprint';
import { toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import 'dotenv/config';
import { preprocBuildContractsLocal } from '../helpers/helpers';
import { PoolCSI } from '../wrappers/Pool';
import { SLIM_CONFIG_LEGACY } from '../libs/src/test-helpers';

function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('Constant-sum round-trip', () => {
    let bc: Blockchain, code: any, lpW: any, lpA: any;
    let router: SandboxContract<TreasuryContract>,
        user: SandboxContract<TreasuryContract>,
        w0: SandboxContract<TreasuryContract>,
        w1: SandboxContract<TreasuryContract>,
        pf: SandboxContract<TreasuryContract>;

    const mkPool = (r0: bigint, r1: bigint, lpFee: bigint, tsl: bigint) => {
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
        };
        return bc.openContract(PoolCSI.createFromConfig(cfg, code));
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
            dexType: 'constant_sum',
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

    it('round-trip cannot profit', async () => {
        const rng = mulberry32(4242);
        const N = 250;
        const rand = (a: number, b: number) => BigInt(Math.floor(a + rng() * (b - a)));
        let tested = 0;
        for (let i = 0; i < N; i++) {
            const r0 = rand(1_000_000_000, 1_000_000_000_000);
            const r1 = rand(1_000_000_000, 1_000_000_000_000);
            const cap = r1 / 4n > 1n ? r1 / 4n : 2n;
            const amountIn = rand(1, Number(cap));
            const lpFee = rng() < 0.5 ? 0n : rand(0, 101);
            const pool = mkPool(r0, r1, lpFee, BigInt(1_000_000_000 + i));
            await doSwap(pool, true, amountIn);
            let d1: any;
            try {
                d1 = await pool.getPoolData();
            } catch {
                continue;
            }
            const d1L = BigInt(d1.leftReserve),
                d1R = BigInt(d1.rightReserve);
            if (d1L === r0 && d1R === r1) continue;
            const out1 = r1 - d1R;
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
            if (d2L === d1L && d2R === d1R) continue;
            const out2 = d1L - d2L;
            tested++;
            if (out2 > amountIn)
                throw new Error(
                    `CSI ROUND-TRIP PROFIT i=${i} r0=${r0} r1=${r1} lpFee=${lpFee} in=${amountIn} out1=${out1} out2=${out2} profit=${out2 - amountIn}`,
                );
        }
        console.log(`CSI round-trip: ${tested} effective cases, no profit`);
    }, 180000);
});
