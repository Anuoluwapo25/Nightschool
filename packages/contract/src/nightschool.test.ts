import { beforeEach, describe, expect, it } from 'vitest';
import {
  INVITE_BATCH,
  type NightschoolPrivateState,
  answerDigestOf,
  answerMatches,
  challengeIdOf,
  emptyPrivateState,
  hasClaimed,
  isEnrolled,
  pureCircuits,
  randomBytes32,
  slugOf,
  toHex,
} from './index.js';
import { NightschoolSimulator } from './simulator.js';

const INSTRUCTOR_SK = randomBytes32();
const instructor = emptyPrivateState({ instructorSecretKey: INSTRUCTOR_SK });

const CHALLENGE = challengeIdOf('first-hash');
const ANSWER = 'b1946ac92492d2347c6235b4d2611184e3a6b2bd7b0a8f3e1b5b3b2f1e9c8a7d';
const REWARD = 25n;

/** Fresh invite codes, plus the batch of hashes the instructor publishes. */
const invites = (): { codes: Uint8Array[]; batch: Uint8Array[] } => {
  const codes = Array.from({ length: INVITE_BATCH }, randomBytes32);
  return { codes, batch: codes.map((code) => pureCircuits.inviteHash(code)) };
};

const learner = (): NightschoolPrivateState =>
  emptyPrivateState({ learnerSecret: randomBytes32() });

let sim: NightschoolSimulator;
let codes: Uint8Array[];

const enrol = (who: NightschoolPrivateState, code: Uint8Array): void => {
  sim.as({ ...who, inviteCode: code }).enroll(pureCircuits.learnerCommitment(who.learnerSecret));
};

const claim = async (who: NightschoolPrivateState, answer: string, id = CHALLENGE) => {
  sim.as({ ...who, answerDigest: await answerDigestOf(answer) }).claim(id);
};

beforeEach(async () => {
  sim = new NightschoolSimulator(INSTRUCTOR_SK);
  const fresh = invites();
  codes = fresh.codes;
  sim.as(instructor).addInvites(fresh.batch);
  sim
    .as(instructor)
    .addChallenge(
      CHALLENGE,
      pureCircuits.answerCommitment(CHALLENGE, await answerDigestOf(ANSWER)),
      REWARD,
    );
});

describe('instructor', () => {
  it('binds the instructor key at deployment and publishes challenges', () => {
    expect(sim.ledger.instructor).toEqual(pureCircuits.instructorPublicKey(INSTRUCTOR_SK));
    expect(sim.ledger.challenges.member(CHALLENGE)).toBe(true);
    expect(sim.ledger.rewards.lookup(CHALLENGE)).toBe(REWARD);
    expect(sim.ledger.solves.lookup(CHALLENGE)).toBe(0n);
    expect(sim.ledger.invites.size()).toBe(BigInt(INVITE_BATCH));
  });

  it('refuses invites and challenges from anyone else', () => {
    const impostor = emptyPrivateState({ instructorSecretKey: randomBytes32() });
    expect(() => sim.as(impostor).addInvites(invites().batch)).toThrow(/not the instructor/);
    expect(() =>
      sim.as(impostor).addChallenge(challengeIdOf('other'), randomBytes32(), 1n),
    ).toThrow(/not the instructor/);
  });

  it('refuses to overwrite an existing challenge', () => {
    expect(() => sim.as(instructor).addChallenge(CHALLENGE, randomBytes32(), 1n)).toThrow(
      /already exists/,
    );
  });
});

describe('enroll', () => {
  it('redeems an invite once', () => {
    const alice = learner();
    enrol(alice, codes[0]!);
    expect(sim.ledger.enrolled).toBe(1n);
    expect(sim.ledger.invites.size()).toBe(BigInt(INVITE_BATCH - 1));
    expect(isEnrolled(sim.ledger, alice.learnerSecret)).toBe(true);

    expect(() => enrol(learner(), codes[0]!)).toThrow(/unknown or already used/);
  });

  it('refuses a made-up invite', () => {
    expect(() => enrol(learner(), randomBytes32())).toThrow(/unknown or already used/);
  });
});

describe('claim', () => {
  it('pays an enrolled learner who knows the answer, without putting the answer on chain', async () => {
    const alice = learner();
    enrol(alice, codes[0]!);
    await claim(alice, ANSWER);

    expect(sim.ledger.solves.lookup(CHALLENGE)).toBe(1n);
    expect(sim.ledger.totalClaims).toBe(1n);
    expect(hasClaimed(sim.ledger, alice.learnerSecret, CHALLENGE)).toBe(true);

    // The reward is one shielded coin worth exactly the challenge's reward.
    const [reward] = sim.zswap.outputs;
    expect(sim.zswap.outputs).toHaveLength(1);
    expect(reward!.coinInfo.value).toBe(REWARD);

    // Nothing public carries the answer, its digest, or the learner's enrolment.
    const digest = toHex(await answerDigestOf(ANSWER));
    const enrolment = toHex(pureCircuits.learnerCommitment(alice.learnerSecret));
    const [nullifier] = [...sim.ledger.claimed].map(toHex);
    expect(nullifier).not.toBe(digest);
    expect(nullifier).not.toBe(enrolment);
    expect(nullifier).not.toContain(ANSWER);
  });

  it('accepts the answer however it is cased or padded', async () => {
    const alice = learner();
    enrol(alice, codes[0]!);
    await claim(alice, `  0x${ANSWER.toUpperCase()}\n`);
    expect(sim.ledger.solves.lookup(CHALLENGE)).toBe(1n);
  });

  it('refuses a wrong answer', async () => {
    const alice = learner();
    enrol(alice, codes[0]!);
    await expect(claim(alice, 'not-the-answer')).rejects.toThrow(/wrong answer/);
    expect(sim.ledger.totalClaims).toBe(0n);
  });

  it('refuses a learner who never enrolled', async () => {
    await expect(claim(learner(), ANSWER)).rejects.toThrow(/not in the enrolment tree/);
  });

  it('refuses a second claim by the same learner, whatever wallet submits it', async () => {
    const alice = learner();
    enrol(alice, codes[0]!);
    await claim(alice, ANSWER);
    await expect(claim(alice, ANSWER)).rejects.toThrow(/already claimed/);
    expect(sim.ledger.solves.lookup(CHALLENGE)).toBe(1n);
  });

  it('lets different learners each claim once, unlinkably', async () => {
    const alice = learner();
    const bob = learner();
    enrol(alice, codes[0]!);
    enrol(bob, codes[1]!);
    await claim(alice, ANSWER);
    await claim(bob, ANSWER);

    expect(sim.ledger.solves.lookup(CHALLENGE)).toBe(2n);
    const nullifiers = [...sim.ledger.claimed].map(toHex);
    expect(new Set(nullifiers).size).toBe(2);
  });

  it('refuses one challenge answer for another challenge', async () => {
    const other = challengeIdOf('second-hash');
    sim
      .as(instructor)
      .addChallenge(
        other,
        pureCircuits.answerCommitment(other, await answerDigestOf('a-different-answer')),
        5n,
      );
    const alice = learner();
    enrol(alice, codes[0]!);
    await expect(claim(alice, ANSWER, other)).rejects.toThrow(/wrong answer/);
  });

  it('refuses an unknown challenge', async () => {
    const alice = learner();
    enrol(alice, codes[0]!);
    await expect(claim(alice, ANSWER, challengeIdOf('nope'))).rejects.toThrow(/unknown challenge/);
  });
});

describe('client helpers', () => {
  it('checks an answer locally against the on-chain commitment', async () => {
    expect(await answerMatches(sim.ledger, CHALLENGE, ANSWER)).toBe(true);
    expect(await answerMatches(sim.ledger, CHALLENGE, 'wrong')).toBe(false);
  });

  it('round-trips challenge slugs', () => {
    expect(slugOf(challengeIdOf('first-hash'))).toBe('first-hash');
    expect(() => challengeIdOf('x'.repeat(33))).toThrow(/exceeds 32 bytes/);
  });
});
