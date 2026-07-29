// SPDX-License-Identifier: GPL-3.0-only
import { compile } from '@ton/blueprint';
import { toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import 'dotenv/config';
import { preprocBuildContractsLocal } from '../helpers/helpers';
import { PoolCPI } from '../wrappers/Pool';
import { SLIM_CONFIG_LEGACY } from '../libs/src/test-helpers';

const FEE_DIVIDER = 10000n;

function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('Invariant fuzz: constant_product swap core', () => {
    let bc: Blockchain;
    let poolCode: any, lpWalletCode: any, lpAccountCode: any;
    let router: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;
    let w0: SandboxContract<TreasuryContract>;
    let w1: SandboxContract<TreasuryContract>;
    let pf: SandboxContract<TreasuryContract>;

    beforeAll(async () => {
        preprocBuildContractsLocal({
            dexType: 'constant_product',
            defaultProtocolFee: null,
            defaultIsLocked: null,
            defaultLPFee: null,
        } as any);
        poolCode = await compile('Pool');
        lpWalletCode = await compile('LPWallet');
        lpAccountCode = await compile('LPAccount');

        bc = await Blockchain.create({ config: SLIM_CONFIG_LEGACY });
        router = await bc.treasury('router');
        user = await bc.treasury('user');
        w0 = await bc.treasury('w0');
        w1 = await bc.treasury('w1');
        pf = await bc.treasury('pf');
    });

    it('reserve deltas match get_swap_out exactly and k never decreases', async () => {
        const rng = mulberry32(1337);
        const N = 300;
        const rand = (min: number, max: number) => BigInt(Math.floor(min + rng() * (max - min)));

        for (let i = 0; i < N; i++) {
            const r0 = rand(1_000, 1_000_000_000_000);
            const r1 = rand(1_000, 1_000_000_000_000);
            const amountIn = rand(1, 1_000_000_000_000);
            const lpFee = rand(0, 101);
            const side = rng() < 0.5;
            const totalSupplyLP = BigInt(1_000_000_000 + i);

            const cfg = {
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
                totalSupplyLP,
                LPWalletCode: lpWalletCode,
                LPAccountCode: lpAccountCode,
            };

            const pool = bc.openContract(PoolCPI.createFromConfig(cfg as any, poolCode));

            const rin = side ? r0 : r1;
            const rout = side ? r1 : r0;
            const amountInWithFee = amountIn * (FEE_DIVIDER - lpFee);
            const baseOrig = (amountInWithFee * rout) / (rin * FEE_DIVIDER + amountInWithFee);
            const rinNew = rin + amountIn;
            const routNew = rout - baseOrig;
            const success = baseOrig >= 1n && routNew > 0n;

            const ctx = `i=${i} r0=${r0} r1=${r1} in=${amountIn} lpFee=${lpFee} side=${side} baseOrig=${baseOrig}`;

            await pool.sendSwap(
                router.getSender(),
                {
                    leftAmount: side ? amountIn : 0n,
                    rightAmount: side ? 0n : amountIn,
                    fromAddress: user.address,
                    refAddress: router.address,
                    refValue: 0,
                    deadline: 4_000_000_000,
                    minOut: 1n,
                } as any,
                toNano('1'),
            );

            let d: any;
            try {
                d = await pool.getPoolData();
            } catch (e) {
                throw new Error(`getPoolData failed (pool crashed?) ${ctx} :: ${(e as Error).message}`);
            }

            if (success) {
                const exp0 = side ? rinNew : routNew;
                const exp1 = side ? routNew : rinNew;
                if (d.leftReserve !== exp0 || d.rightReserve !== exp1) {
                    throw new Error(
                        `RESERVE MISMATCH ${ctx} exp0=${exp0} exp1=${exp1} got0=${d.leftReserve} got1=${d.rightReserve}`,
                    );
                }
                if (exp0 * exp1 < r0 * r1) {
                    throw new Error(`K DECREASED ${ctx} kOld=${r0 * r1} kNew=${exp0 * exp1}`);
                }
            } else {
                if (d.leftReserve !== r0 || d.rightReserve !== r1) {
                    throw new Error(`REFUND CHANGED RESERVES ${ctx} got0=${d.leftReserve} got1=${d.rightReserve}`);
                }
            }
        }
    }, 120000);
});
