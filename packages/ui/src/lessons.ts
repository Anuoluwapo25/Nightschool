/**
 * The curriculum. Each lesson teaches one Midnight idea and ends in a task
 * whose answer is the output of doing it — a transaction hash, a hash, a
 * commitment, a nullifier. Answers are 32-byte values, so their on-chain
 * commitments cannot be reversed by guessing.
 *
 * The slugs match the challenge ids on chain.
 */

export type Lesson = {
  readonly slug: string;
  readonly number: string;
  readonly title: string;
  readonly concept: string;
  /** Short paragraphs explaining the idea. */
  readonly body: readonly string[];
  readonly task: string;
  /** A starting point, not the answer. */
  readonly hint: { readonly language: string; readonly code: string };
};

export const LESSONS: readonly Lesson[] = [
  {
    slug: 'read-the-ledger',
    number: '01',
    title: 'Read the ledger',
    concept: 'Public state & the indexer',
    body: [
      'Every Midnight contract has public state that anyone can read, and private state that never leaves its owner. Before you can reason about what is hidden, you need to see what is not.',
      'The indexer is a GraphQL API over the chain. No wallet, no key: you can ask it about any contract. Conserve, a private-payroll contract, lives on Preprod at ecc85abce5e6b1c286eba4f559012ff5ff0cf7bb766dbb35e4cf068b98855a9b. Its public state shows a payroll was paid, but no amount and no recipient.',
    ],
    task: 'Ask the Preprod indexer for the latest action on that contract. The answer is its transaction hash.',
    hint: {
      language: 'graphql',
      code: `# POST https://indexer.preprod.midnight.network/api/v3/graphql
{
  contractAction(address: "<the contract address>") {
    __typename
    transaction { ??? }
  }
}`,
    },
  },
  {
    slug: 'first-hash',
    number: '02',
    title: 'Your first hash',
    concept: 'persistentHash',
    body: [
      'Compact circuits compute over private data and publish only what you disclose. The most common thing to publish is a hash: a fingerprint that binds you to a value without showing it.',
      'persistentHash is stable across versions, so a hash computed today can be checked against the ledger years from now. pad(32, "…") turns a string literal into 32 bytes. Write the circuit, compile it with `compact compile --skip-zk`, and call it from TypeScript through `pureCircuits`.',
    ],
    task: 'Compute persistentHash<Vector<2, Bytes<32>>> of [pad(32, "nightschool"), pad(32, "hello midnight")]. Give the 32 bytes as hex.',
    hint: {
      language: 'compact',
      code: `pragma language_version >= 0.17;
import CompactStandardLibrary;

export pure circuit answer(): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([ /* … */ ]);
}`,
    },
  },
  {
    slug: 'commit-and-hide',
    number: '03',
    title: 'Commit and hide',
    concept: 'persistentCommit',
    body: [
      'A hash of a small value is not private: anyone can hash 0, 1, 2… until they match. A commitment adds a random salt, so the value stays hidden until you choose to open it — and you cannot change your mind afterwards.',
      'Conserve commits to a payroll budget this way. Nightschool commits to every challenge answer this way too, binding it to the challenge id, so you can check your answer against the chain without anyone learning it.',
    ],
    task: 'Compute persistentCommit<Uint<64>>(42, pad(32, "my-salt")). Give the 32 bytes as hex.',
    hint: {
      language: 'compact',
      code: `export pure circuit answer(): Bytes<32> {
  return persistentCommit<Uint<64>>(/* value */, /* salt */);
}`,
    },
  },
  {
    slug: 'nullifiers',
    number: '04',
    title: 'Nullifiers',
    concept: 'Spend once, stay anonymous',
    body: [
      'How do you stop someone claiming twice without knowing who they are? Publish a nullifier: a value derived from their secret and the thing being claimed. The same person claiming again produces the same nullifier and is refused. Without the secret, nobody can link it to them.',
      'This is exactly how your claims on this page work. Read the claimNullifier circuit in nightschool.compact, then compute one yourself.',
    ],
    task: 'Compute Nightschool’s claimNullifier with secret = pad(32, "alice") and challengeId = pad(32, "first-hash"). Give it as hex.',
    hint: {
      language: 'typescript',
      code: `import { pureCircuits } from '@nightschool/contract';

const pad = (s: string) => { /* UTF-8, zero-padded to 32 bytes */ };
pureCircuits.claimNullifier(pad('alice'), pad('first-hash'));`,
    },
  },
];

export const lessonBySlug = (slug: string): Lesson | undefined =>
  LESSONS.find((lesson) => lesson.slug === slug);
