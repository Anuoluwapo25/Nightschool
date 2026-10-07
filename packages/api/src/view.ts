/**
 * The read-only projection of a Nightschool contract: everything an outside
 * observer can learn. Browser-safe, so the site and the CLI render public state
 * through the same code.
 */

import { type Ledger, slugOf, toHex } from '@nightschool/contract';

export type PublicChallenge = {
  readonly slug: string;
  readonly id: string;
  /** Commitment to the answer — useless without the answer itself. */
  readonly answerCommitment: string;
  readonly reward: bigint;
  readonly solves: bigint;
};

export type PublicView = {
  readonly enrolled: bigint;
  readonly invitesOutstanding: bigint;
  readonly totalClaims: bigint;
  readonly challenges: readonly PublicChallenge[];
  readonly instructor: string;
};

export const summarise = (state: Ledger): PublicView => ({
  enrolled: state.enrolled,
  invitesOutstanding: state.invites.size(),
  totalClaims: state.totalClaims,
  instructor: toHex(state.instructor),
  challenges: [...state.challenges].map(([id, commitment]) => ({
    slug: slugOf(id),
    id: toHex(id),
    answerCommitment: toHex(commitment),
    reward: state.rewards.member(id) ? state.rewards.lookup(id) : 0n,
    solves: state.solves.member(id) ? state.solves.lookup(id) : 0n,
  })),
});
