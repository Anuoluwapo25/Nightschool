/**
 * Witness bindings and private-state helpers for the Nightschool contract.
 *
 * Everything in {@link NightschoolPrivateState} stays on the learner's (or the
 * instructor's) machine. The proof server reads it to build a proof; the ledger
 * never sees it.
 *
 * Free of Node-only imports: the browser imports this module as-is.
 */

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import {
  type Ledger,
  Contract,
  ledger,
  pureCircuits,
} from '../managed/nightschool/contract/index.js';

export { Contract, ledger, pureCircuits };
export type { Ledger };

/** Invites are published eight at a time; see `addInvites`. */
export const INVITE_BATCH = 8;

/** Depth of the enrolment tree: room for 2^10 learners per deployment. */
export const LEARNER_TREE_DEPTH = 10;

export type NightschoolPrivateState = {
  /** Authorises `addInvites` and `addChallenge`. Only its hash is on chain. Zero for a learner. */
  readonly instructorSecretKey: Uint8Array;
  /** The learner's identity. Only its hash was enrolled, and claims never reveal which hash. */
  readonly learnerSecret: Uint8Array;
  /** The invite being redeemed by `enroll`. */
  readonly inviteCode: Uint8Array;
  /** SHA-256 of the answer being proved by `claim`. */
  readonly answerDigest: Uint8Array;
};

export const randomBytes32 = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

export const emptyPrivateState = (
  overrides: Partial<NightschoolPrivateState> = {},
): NightschoolPrivateState => ({
  instructorSecretKey: new Uint8Array(32),
  learnerSecret: new Uint8Array(32),
  inviteCode: new Uint8Array(32),
  answerDigest: new Uint8Array(32),
  ...overrides,
});

type Ctx = WitnessContext<Ledger, NightschoolPrivateState>;

export class NotEnrolledError extends Error {
  constructor() {
    super(
      'nightschool: this learner is not in the enrolment tree. Redeem an invite with `enroll` first, ' +
        'or check that the learner secret is the one that was enrolled.',
    );
  }
}

export const witnesses = {
  instructorSecretKey: ({ privateState }: Ctx): [NightschoolPrivateState, Uint8Array] => [
    privateState,
    privateState.instructorSecretKey,
  ],
  learnerSecret: ({ privateState }: Ctx): [NightschoolPrivateState, Uint8Array] => [
    privateState,
    privateState.learnerSecret,
  ],
  // The path comes from public state: anyone could compute it, but only the
  // holder of the secret behind the leaf can use it in a proof.
  learnerPath: ({ privateState, ledger: state }: Ctx, leaf: Uint8Array) => {
    const path = state.learners.findPathForLeaf(leaf);
    if (path === undefined) throw new NotEnrolledError();
    return [privateState, path] as [NightschoolPrivateState, typeof path];
  },
  inviteCode: ({ privateState }: Ctx): [NightschoolPrivateState, Uint8Array] => [
    privateState,
    privateState.inviteCode,
  ],
  answerDigest: ({ privateState }: Ctx): [NightschoolPrivateState, Uint8Array] => [
    privateState,
    privateState.answerDigest,
  ],
};

// ---------------------------------------------------------------------------
// Encodings shared by the CLI, the browser and the tests
// ---------------------------------------------------------------------------

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const fromHex = (value: string): Uint8Array => {
  const hex = value.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('nightschool: expected a 32-byte hex string');
  }
  return Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16));
};

/**
 * A challenge id is its slug, UTF-8 encoded and zero-padded to 32 bytes — the
 * same encoding Compact's `pad(32, "...")` produces — so ids read as text in a
 * block explorer and need no lookup table.
 */
export const challengeIdOf = (slug: string): Uint8Array => {
  const bytes = new TextEncoder().encode(slug);
  if (bytes.length > 32) throw new Error(`nightschool: challenge slug "${slug}" exceeds 32 bytes`);
  const out = new Uint8Array(32);
  out.set(bytes);
  return out;
};

export const slugOf = (id: Uint8Array): string =>
  new TextDecoder().decode(id.slice(0, id.indexOf(0) === -1 ? 32 : id.indexOf(0)));

/**
 * Answers are compared case- and whitespace-insensitively, so "0xAB…" and
 * "ab…" are the same answer. Challenges are designed so the answer is the
 * output of real work — a hash, a transaction id — and therefore too
 * high-entropy to guess from its public commitment.
 */
export const normaliseAnswer = (answer: string): string =>
  answer.trim().toLowerCase().replace(/^0x/, '');

/** SHA-256 of the normalised answer: the private input `claim` proves knowledge of. */
export const answerDigestOf = async (answer: string): Promise<Uint8Array> =>
  new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normaliseAnswer(answer))),
  );

/** Invite codes are handed out as hex; this is what goes into `addInvites`. */
export const newInvite = (): { code: string; hash: string } => {
  const code = randomBytes32();
  return { code: toHex(code), hash: toHex(pureCircuits.inviteHash(code)) };
};

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Checks an answer against a challenge's on-chain commitment, locally. Nothing
 * is sent anywhere: it is the same comparison the `claim` circuit makes, run
 * before spending a proof on it.
 */
export const answerMatches = async (
  state: Ledger,
  challengeId: Uint8Array,
  answer: string,
): Promise<boolean> => {
  if (!state.challenges.member(challengeId)) return false;
  const expected = state.challenges.lookup(challengeId);
  return equalBytes(
    expected,
    pureCircuits.answerCommitment(challengeId, await answerDigestOf(answer)),
  );
};

/** Whether this learner has already claimed this challenge. */
export const hasClaimed = (
  state: Ledger,
  learnerSecret: Uint8Array,
  challengeId: Uint8Array,
): boolean => state.claimed.member(pureCircuits.claimNullifier(learnerSecret, challengeId));

/** Whether this learner's commitment is in the enrolment tree. */
export const isEnrolled = (state: Ledger, learnerSecret: Uint8Array): boolean =>
  state.learners.findPathForLeaf(pureCircuits.learnerCommitment(learnerSecret)) !== undefined;

/** The domain separator Night Credits are minted under; see `claim`. */
export const CREDIT_DOMAIN: Uint8Array = challengeIdOf('nightschool:credit:v1');
