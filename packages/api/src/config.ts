/**
 * Network endpoints for the environments Nightschool runs against.
 *
 * Browser-safe: `process` is only read when it exists.
 */

export type NetworkProfile = 'preprod' | 'undeployed';

export type NetworkConfig = {
  /** Value handed to `setNetworkId` so addresses serialise for the right chain. */
  readonly networkId: string;
  readonly indexerUrl: string;
  readonly indexerWsUrl: string;
  readonly nodeUrl: string;
  /**
   * Always local. The proof server sees the learner's secret and their answer
   * in the clear while it proves, so sending them to someone else's would undo
   * the point.
   */
  readonly proofServerUrl: string;
  readonly explorerUrl?: string;
};

const PREPROD: NetworkConfig = {
  networkId: 'preprod',
  indexerUrl: 'https://indexer.preprod.midnight.network/api/v3/graphql',
  indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
  nodeUrl: 'https://rpc.preprod.midnight.network',
  proofServerUrl: 'http://127.0.0.1:6300',
  explorerUrl: 'https://explorer.preprod.midnight.network',
};

const UNDEPLOYED: NetworkConfig = {
  networkId: 'undeployed',
  indexerUrl: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  nodeUrl: 'http://127.0.0.1:9944',
  proofServerUrl: 'http://127.0.0.1:6300',
};

const PROFILES: Record<NetworkProfile, NetworkConfig> = {
  preprod: PREPROD,
  undeployed: UNDEPLOYED,
};

export const isNetworkProfile = (value: string): value is NetworkProfile => value in PROFILES;

const env = (name: string): string | undefined =>
  typeof process === 'undefined' ? undefined : process.env?.[name];

/** Resolves a profile, letting each endpoint be overridden from the environment. */
export const networkConfig = (profile: NetworkProfile = 'preprod'): NetworkConfig => {
  const base = PROFILES[profile];
  return {
    ...base,
    indexerUrl: env('NIGHTSCHOOL_INDEXER_URL') ?? base.indexerUrl,
    indexerWsUrl: env('NIGHTSCHOOL_INDEXER_WS_URL') ?? base.indexerWsUrl,
    nodeUrl: env('NIGHTSCHOOL_NODE_URL') ?? base.nodeUrl,
    proofServerUrl: env('NIGHTSCHOOL_PROOF_SERVER_URL') ?? base.proofServerUrl,
  };
};

/**
 * The contract each network is running, so the site shows live state with
 * nothing pasted in.
 */
export const DEPLOYED_CONTRACT: Partial<Record<NetworkProfile, string>> = {
  preprod: 'b6b2c5e5348618c64e9e269835088aaea2a633ba94aece3fcd2508253a204c24',
};

/** Key under which a party's private state is stored locally. */
export const NIGHTSCHOOL_PRIVATE_STATE_ID = 'nightschool-private-state';
