/**
 * Assembles the six providers midnight-js needs to build, prove, balance and
 * submit a Nightschool transaction from Node (the CLI).
 */

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { MidnightProvider, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { NightschoolPrivateState } from '@nightschool/contract';
import { NIGHTSCHOOL_PRIVATE_STATE_ID, type NetworkConfig } from './config.js';
import type { NightschoolCircuitId } from './contract.js';
import type { NightschoolProviders } from './nightschool.js';

export type WalletProviders = {
  readonly walletProvider: WalletProvider;
  readonly midnightProvider: MidnightProvider;
};

/** Where the Compact compiler wrote the prover keys, verifier keys and ZK IR. */
export const zkAssetsDirectory = (): string => {
  const require = createRequire(import.meta.url);
  return resolve(dirname(require.resolve('@nightschool/contract')), '../managed/nightschool');
};

/** The client's own default is five minutes; be generous on slow machines. */
const PROOF_TIMEOUT_MS = 30 * 60 * 1000;

export type ProviderOptions = {
  readonly config: NetworkConfig;
  readonly wallet: WalletProviders;
  /** Scopes the local private-state store. */
  readonly accountId: string;
  /** Encrypts the local private-state store at rest. */
  readonly password: () => string | Promise<string>;
};

export const buildProviders = ({
  config,
  wallet,
  accountId,
  password,
}: ProviderOptions): NightschoolProviders => {
  setNetworkId(config.networkId);
  const zkConfigProvider = new NodeZkConfigProvider<NightschoolCircuitId>(zkAssetsDirectory());
  return {
    privateStateProvider: levelPrivateStateProvider<
      typeof NIGHTSCHOOL_PRIVATE_STATE_ID,
      NightschoolPrivateState
    >({
      privateStateStoreName: 'nightschool-private-state',
      accountId,
      privateStoragePasswordProvider: password,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexerUrl, config.indexerWsUrl),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServerUrl, zkConfigProvider, {
      timeout: PROOF_TIMEOUT_MS,
    }),
    walletProvider: wallet.walletProvider,
    midnightProvider: wallet.midnightProvider,
  } as NightschoolProviders;
};
