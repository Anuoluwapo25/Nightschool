/**
 * The curriculum. Each lesson teaches one Midnight idea, lets the learner play
 * with it, and ends in a task whose answer is the output of doing it — a
 * transaction hash, a hash, a commitment, a nullifier. Answers are 32-byte
 * values, so their on-chain commitments cannot be reversed by guessing.
 *
 * The slugs match the challenge ids on chain.
 */

export type Widget = 'query' | 'pad' | 'bruteforce' | 'nullifiers';

export type Paragraph = {
  readonly text: string;
  /** A margin note beside this paragraph. */
  readonly aside?: string;
};

export type Lesson = {
  readonly slug: string;
  readonly number: number;
  readonly title: string;
  readonly concept: string;
  /** One sentence: why this matters. */
  readonly hook: string;
  readonly paragraphs: readonly Paragraph[];
  readonly widget: Widget;
  readonly widgetTitle: string;
  readonly task: string;
  /** A starting point, not the answer. */
  readonly hint: { readonly language: string; readonly code: string };
  /** What the learner can now say they know. */
  readonly takeaway: string;
};

export const CONSERVE_ADDRESS = 'ecc85abce5e6b1c286eba4f559012ff5ff0cf7bb766dbb35e4cf068b98855a9b';

export const LESSONS: readonly Lesson[] = [
  {
    slug: 'read-the-ledger',
    number: 1,
    title: 'Read the ledger',
    concept: 'Public state',
    hook: 'Before you can hide anything, you need to see what everyone can see.',
    paragraphs: [
      {
        text: 'Every Midnight contract has two halves. Public state lives on the chain where anyone can read it. Private state stays on its owner’s machine and never leaves. The whole craft of building on Midnight is deciding which facts go where.',
        aside: 'Think of it as two rooms: one with the curtains open, one with them drawn.',
      },
      {
        text: 'The indexer is a GraphQL API over the public half. It needs no wallet and no key, which is the point: public means anyone. Conserve, a private-payroll contract, lives on Preprod. Its public state proves a payroll was paid, yet you will not find a single salary in it.',
        aside: `Conserve’s address:\n${CONSERVE_ADDRESS}`,
      },
      {
        text: 'Use the box below to ask the indexer about Conserve. The query is real and so is the answer.',
      },
    ],
    widget: 'query',
    widgetTitle: 'Ask the Preprod indexer',
    task: 'Find the latest action on Conserve’s contract. The answer is its transaction hash.',
    hint: {
      language: 'graphql',
      code: `# Not sure which fields exist? Ask the schema itself:
{ __type(name: "Transaction") { fields { name } } }`,
    },
    takeaway:
      'You can read any Midnight contract’s public state, and you know what is missing from it.',
  },
  {
    slug: 'first-hash',
    number: 2,
    title: 'Your first hash',
    concept: 'persistentHash',
    hook: 'A hash is how you point at a value without showing it.',
    paragraphs: [
      {
        text: 'Compact circuits compute over private data and publish only what you disclose. The thing most often disclosed is a hash: a 32-byte fingerprint that binds you to a value without revealing it.',
        aside:
          '`persistentHash` is stable across compiler versions, so a hash written today can still be checked years from now.',
      },
      {
        text: 'Hashes in Compact work on fixed-size bytes, so strings are first padded to 32 bytes with `pad(32, "…")`. Type below to see exactly what that means: your text’s UTF-8 bytes, then zeros to fill the rest.',
      },
      {
        text: 'Then write a pure circuit, compile it with `compact compile --skip-zk`, and call it from TypeScript through `pureCircuits`. That is the whole loop: write, compile, call.',
        aside: '--skip-zk skips generating proving keys. A pure circuit never needs them.',
      },
    ],
    widget: 'pad',
    widgetTitle: 'What pad(32, …) does',
    task: 'Compute `persistentHash<Vector<2, Bytes<32>>>` of `[pad(32, "nightschool"), pad(32, "hello midnight")]`. Give the 32 bytes as hex.',
    hint: {
      language: 'compact',
      code: `pragma language_version >= 0.17;
import CompactStandardLibrary;

export pure circuit answer(): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([ /* … */ ]);
}`,
    },
    takeaway:
      'You can write, compile and call a Compact circuit, and you know what a hash does and does not hide.',
  },
  {
    slug: 'commit-and-hide',
    number: 3,
    title: 'Commit and hide',
    concept: 'persistentCommit',
    hook: 'A hash of a small number hides nothing. A commitment does.',
    paragraphs: [
      {
        text: 'If a value can only be one of a few things — a vote, an age, a score out of 100 — its hash protects nothing. Anyone can hash every possibility and see which one matches. Try it below.',
      },
      {
        text: 'A commitment mixes in a random salt. Without the salt, guessing is hopeless; with it, you can later open the commitment and prove what was inside. And once it is on chain, you cannot change your mind.',
        aside:
          'This is “hiding” and “binding”: nobody can see inside, and you cannot swap what is inside.',
      },
      {
        text: 'Conserve commits to a payroll budget this way. Nightschool commits to every answer on this page this way too — which is why your answers are safe to check against the chain.',
      },
    ],
    widget: 'bruteforce',
    widgetTitle: 'Crack a hidden score',
    task: 'Compute `persistentCommit<Uint<64>>(42, pad(32, "my-salt"))`. Give the 32 bytes as hex.',
    hint: {
      language: 'compact',
      code: `export pure circuit answer(): Bytes<32> {
  return persistentCommit<Uint<64>>(/* value */, /* salt */);
}`,
    },
    takeaway: 'You know when a hash is enough, when it is not, and how a salt changes that.',
  },
  {
    slug: 'nullifiers',
    number: 4,
    title: 'Nullifiers',
    concept: 'Spend once, stay anonymous',
    hook: 'How do you stop someone acting twice without knowing who they are?',
    paragraphs: [
      {
        text: 'Publish a nullifier: a value derived from a person’s secret and the thing they are doing. The same person doing the same thing again produces the same nullifier, and the contract refuses it. A different person, or a different thing, produces something unrelated.',
        aside: 'Zcash invented the idea to stop the same coin being spent twice.',
      },
      {
        text: 'Without the secret, a nullifier cannot be linked to anyone — not to their wallet, not to their other actions. Play with Alice and Bob below.',
      },
      {
        text: 'This is exactly how your claims on this page work. Read the `claimNullifier` circuit in `nightschool.compact`, then compute one yourself.',
      },
    ],
    widget: 'nullifiers',
    widgetTitle: 'Alice, Bob and two challenges',
    task: 'Compute Nightschool’s `claimNullifier` with secret `pad(32, "alice")` and challenge id `pad(32, "first-hash")`. Give it as hex.',
    hint: {
      language: 'typescript',
      code: `import { pureCircuits } from '@nightschool/contract';

const pad = (s: string) => { /* UTF-8, zero-padded to 32 bytes */ };
pureCircuits.claimNullifier(pad('alice'), pad('first-hash'));`,
    },
    takeaway:
      'You can stop double-actions without identifying anyone — the core trick behind private voting, airdrops and this page.',
  },
];

/** Lessons the curriculum will add, shown dimmed on the map. */
export const COMING: readonly { title: string; concept: string }[] = [
  { title: 'The disclose rule', concept: 'What the compiler refuses to leak' },
  { title: 'Merkle membership', concept: 'Prove you belong without saying who' },
  { title: 'Shielded tokens', concept: 'Value nobody can trace' },
];
