/**
 * Nightschool workflows: deploy, publish invites and challenges, enrol, claim.
 *
 * Browser-safe: providers come in from the caller, so the CLI (headless wallet,
 * files on disk) and the site (browser wallet, keys fetched by URL) run exactly
 * the same code.
 *
 * Every call validates locally against the same rules the circuit enforces
 * before it asks for a proof. A wrong answer or a used invite then fails in
 * milliseconds with a readable message, rather than after a proof.
 */

import {
  type DeployedContract,
  type FoundContract,
  deployContract,
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  INVITE_BATCH,
  type Ledger,
  type NightschoolPrivateState,
  answerDigestOf,
  answerMatches,
  challengeIdOf,
  emptyPrivateState,
  fromHex,
  hasClaimed,
  isEnrolled,
  ledger,
  newInvite,
  pureCircuits,
} from '@nightschool/contract';
import { NIGHTSCHOOL_PRIVATE_STATE_ID } from './config.js';
import {
  type NightschoolCircuitId,
  type NightschoolContract,
  nightschoolCompiledContract,
} from './contract.js';

export type NightschoolProviders = MidnightProviders<
  NightschoolCircuitId,
  typeof NIGHTSCHOOL_PRIVATE_STATE_ID,
  NightschoolPrivateState
>;

export type NightschoolDeployment =
  DeployedContract<NightschoolContract> | FoundContract<NightschoolContract>;

export type TxResult = { readonly txId: string; readonly blockHeight: number };

const txResult = (finalized: { public: { txId: string; blockHeight: number } }): TxResult => ({
  txId: finalized.public.txId,
  blockHeight: finalized.public.blockHeight,
});

export const contractAddressOf = (deployment: NightschoolDeployment): ContractAddress =>
  deployment.deployTxData.public.contractAddress;

/** Deploys a fresh Nightschool bound to the instructor's key. */
export const deploy = async (
  providers: NightschoolProviders,
  instructorSecretKey: Uint8Array,
): Promise<DeployedContract<NightschoolContract>> =>
  deployContract(providers, {
    compiledContract: nightschoolCompiledContract,
    privateStateId: NIGHTSCHOOL_PRIVATE_STATE_ID,
    initialPrivateState: emptyPrivateState({ instructorSecretKey }),
    args: [pureCircuits.instructorPublicKey(instructorSecretKey)],
  });

/** Reconnects to a contract that is already on chain, as whoever holds `privateState`. */
export const join = async (
  providers: NightschoolProviders,
  contractAddress: ContractAddress,
  privateState: NightschoolPrivateState,
): Promise<FoundContract<NightschoolContract>> =>
  findDeployedContract(providers, {
    compiledContract: nightschoolCompiledContract,
    contractAddress,
    privateStateId: NIGHTSCHOOL_PRIVATE_STATE_ID,
    initialPrivateState: privateState,
  });

/** Reads the public state through whatever public data provider the caller has. */
export const publicState = async (
  providers: Pick<NightschoolProviders, 'publicDataProvider'>,
  contractAddress: ContractAddress,
): Promise<Ledger> => {
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  if (state === null) {
    throw new Error(`nightschool: no contract found at ${contractAddress}`);
  }
  return ledger(state.data);
};

/** Reads the public state with no wallet at all — just an indexer. */
export const readPublicState = (
  indexerUrl: string,
  indexerWsUrl: string,
  contractAddress: ContractAddress,
): Promise<Ledger> =>
  publicState(
    { publicDataProvider: indexerPublicDataProvider(indexerUrl, indexerWsUrl) },
    contractAddress,
  );

/** Hands the next proof the private inputs it needs. */
const prime = (providers: NightschoolProviders, state: NightschoolPrivateState) =>
  providers.privateStateProvider.set(NIGHTSCHOOL_PRIVATE_STATE_ID, state);

export type InviteBatch = TxResult & { readonly codes: readonly string[] };

/**
 * Publishes `batches` × 8 fresh invites and returns their codes. The codes are
 * the only copy anywhere: hand them out, and keep them out of git.
 */
export const addInvites = async (
  providers: NightschoolProviders,
  deployment: NightschoolDeployment,
  instructorSecretKey: Uint8Array,
): Promise<InviteBatch> => {
  const invites = Array.from({ length: INVITE_BATCH }, newInvite);
  await prime(providers, emptyPrivateState({ instructorSecretKey }));
  const finalized = await deployment.callTx.addInvites(invites.map((i) => fromHex(i.hash)));
  return { ...txResult(finalized), codes: invites.map((i) => i.code) };
};

/** Publishes a challenge. Only the commitment to `answer` reaches the chain. */
export const addChallenge = async (
  providers: NightschoolProviders,
  deployment: NightschoolDeployment,
  instructorSecretKey: Uint8Array,
  slug: string,
  answer: string,
  reward: bigint,
): Promise<TxResult> => {
  const id = challengeIdOf(slug);
  const state = await publicState(providers, contractAddressOf(deployment));
  if (state.challenges.member(id)) {
    throw new Error(`nightschool: challenge "${slug}" already exists`);
  }
  await prime(providers, emptyPrivateState({ instructorSecretKey }));
  const commitment = pureCircuits.answerCommitment(id, await answerDigestOf(answer));
  return txResult(await deployment.callTx.addChallenge(id, commitment, reward));
};

/** Redeems an invite, enrolling the learner whose secret is in `privateState`. */
export const enroll = async (
  providers: NightschoolProviders,
  deployment: NightschoolDeployment,
  privateState: NightschoolPrivateState,
  inviteCode: string,
): Promise<TxResult> => {
  const code = fromHex(inviteCode);
  const state = await publicState(providers, contractAddressOf(deployment));
  if (isEnrolled(state, privateState.learnerSecret)) {
    throw new Error('nightschool: this learner is already enrolled');
  }
  if (!state.invites.member(pureCircuits.inviteHash(code))) {
    throw new Error('nightschool: that invite code is unknown or has already been used');
  }
  await prime(providers, { ...privateState, inviteCode: code });
  const commitment = pureCircuits.learnerCommitment(privateState.learnerSecret);
  return txResult(await deployment.callTx.enroll(commitment));
};

export type ClaimRefusal =
  'unknown-challenge' | 'not-enrolled' | 'wrong-answer' | 'already-claimed';

export class ClaimRefused extends Error {
  constructor(
    readonly reason: ClaimRefusal,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Everything `claim` checks, run locally against public state. The answer is
 * hashed in place; nothing leaves the machine.
 */
export const preflightClaim = async (
  state: Ledger,
  privateState: NightschoolPrivateState,
  slug: string,
  answer: string,
): Promise<void> => {
  const id = challengeIdOf(slug);
  if (!state.challenges.member(id)) {
    throw new ClaimRefused('unknown-challenge', `nightschool: no challenge "${slug}"`);
  }
  if (!isEnrolled(state, privateState.learnerSecret)) {
    throw new ClaimRefused('not-enrolled', 'nightschool: enrol with an invite code first');
  }
  if (hasClaimed(state, privateState.learnerSecret, id)) {
    throw new ClaimRefused('already-claimed', `nightschool: you have already claimed "${slug}"`);
  }
  if (!(await answerMatches(state, id, answer))) {
    throw new ClaimRefused('wrong-answer', 'nightschool: that answer is not correct');
  }
};

/**
 * Proves knowledge of the answer, membership of the enrolled set and a fresh
 * nullifier, and mints the reward to the caller's shielded address.
 */
export const claim = async (
  providers: NightschoolProviders,
  deployment: NightschoolDeployment,
  privateState: NightschoolPrivateState,
  slug: string,
  answer: string,
): Promise<TxResult> => {
  const state = await publicState(providers, contractAddressOf(deployment));
  await preflightClaim(state, privateState, slug, answer);
  await prime(providers, { ...privateState, answerDigest: await answerDigestOf(answer) });
  return txResult(await deployment.callTx.claim(challengeIdOf(slug)));
};
