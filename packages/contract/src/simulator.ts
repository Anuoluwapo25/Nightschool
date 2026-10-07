/**
 * In-process harness that runs the Nightschool circuits against a real Compact
 * ledger without a node, a proof server, or a wallet. Used by the test suite.
 *
 * Each call can run as a different party — the instructor, or any learner —
 * by swapping in that party's private state, exactly as separate machines
 * would hold separate private states against one shared ledger.
 */

import {
  type CircuitContext,
  type ZswapLocalState,
  createCircuitContext,
  createConstructorContext,
  decodeZswapLocalState,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  type Ledger,
  type NightschoolPrivateState,
  emptyPrivateState,
  ledger,
  pureCircuits,
  witnesses,
} from './index.js';

/** Stand-in coin public key for the caller of simulated transactions. */
const TEST_COIN_PUBLIC_KEY = '0'.repeat(64);

export class NightschoolSimulator {
  readonly contract: Contract<NightschoolPrivateState>;
  readonly address = sampleContractAddress();
  private context: CircuitContext<NightschoolPrivateState>;

  constructor(instructorSecretKey: Uint8Array) {
    this.contract = new Contract<NightschoolPrivateState>(witnesses);
    const initial = this.contract.initialState(
      createConstructorContext(emptyPrivateState({ instructorSecretKey }), TEST_COIN_PUBLIC_KEY),
      pureCircuits.instructorPublicKey(instructorSecretKey),
    );
    this.context = createCircuitContext(
      this.address,
      TEST_COIN_PUBLIC_KEY,
      initial.currentContractState,
      initial.currentPrivateState,
    );
  }

  /** The public state, exactly as a block explorer would see it. */
  get ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }

  /** Shielded coins the last call created — a claim's reward is here. */
  get zswap(): ZswapLocalState {
    return decodeZswapLocalState(this.context.currentZswapLocalState);
  }

  /** Runs the next call as whoever holds `privateState`. */
  as(privateState: NightschoolPrivateState): this {
    this.context = { ...this.context, currentPrivateState: privateState };
    return this;
  }

  addInvites(batch: Uint8Array[]): void {
    this.context = this.contract.impureCircuits.addInvites(this.context, batch).context;
  }

  addChallenge(challengeId: Uint8Array, commitment: Uint8Array, reward: bigint): void {
    this.context = this.contract.impureCircuits.addChallenge(
      this.context,
      challengeId,
      commitment,
      reward,
    ).context;
  }

  enroll(learner: Uint8Array): void {
    this.context = this.contract.impureCircuits.enroll(this.context, learner).context;
  }

  claim(challengeId: Uint8Array): void {
    this.context = this.contract.impureCircuits.claim(this.context, challengeId).context;
  }
}
