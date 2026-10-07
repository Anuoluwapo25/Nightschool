/**
 * Binds the compiled Compact output to its witness implementations and ZK assets.
 */

import { pipe } from 'effect';
import * as CompiledContract from '@midnight-ntwrk/compact-js/effect/CompiledContract';
import { Contract, type NightschoolPrivateState, witnesses } from '@nightschool/contract';

export type NightschoolContract = Contract<NightschoolPrivateState>;

/** Circuit ids that produce proofs, i.e. everything that needs a proving key. */
export type NightschoolCircuitId = 'addInvites' | 'addChallenge' | 'enroll' | 'claim';

export const CIRCUITS: readonly NightschoolCircuitId[] = [
  'addInvites',
  'addChallenge',
  'enroll',
  'claim',
];

/**
 * The compiled contract handle passed to `deployContract` / `findDeployedContract`,
 * resolved against the ZK config provider's `managed/nightschool/` base.
 */
export const nightschoolCompiledContract = pipe(
  CompiledContract.make<NightschoolContract, NightschoolPrivateState>('nightschool', Contract),
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets('nightschool'),
);
