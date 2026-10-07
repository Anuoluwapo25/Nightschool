/**
 * Prints the wallet's own view of its DUST — spendable coins, balance and how
 * far the dust sync has applied — so a fee rejected as NotNormalized or
 * DustDoubleSpend can be traced to a stale view rather than guessed at.
 */

import { networkConfig } from '@nightschool/api/config';
import { deriveKeys, seedFromHex } from '../packages/cli/dist/keys.js';
import { openWallet, waitForSync } from '../packages/cli/dist/wallet.js';

const wallet = await openWallet(networkConfig('preprod'), deriveKeys(seedFromHex(process.env.NIGHTSCHOOL_SEED)));
const state = await waitForSync(wallet);
const now = new Date();
console.log(
  JSON.stringify(
    {
      synced: state.isSynced,
      dustApplied: String(state.dust.progress?.appliedIndex),
      dustHighest: String(state.dust.progress?.highestRelevantWalletIndex ?? state.dust.progress?.highestIndex),
      dustBalance: String(state.dust.balance(now)),
      dustCoins: state.dust.availableCoins.length,
      pending: state.dust.pendingCoins?.length,
    },
    null,
    2,
  ),
);
await wallet.save();
await wallet.close();
process.exit(0);
