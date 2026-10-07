/**
 * The curriculum. Each lesson teaches one Midnight idea, lets the learner play
 * with it, and ends in a task whose answer is the output of doing it — a
 * transaction hash, a hash, a commitment, a nullifier. Answers are 32-byte
 * values, so their on-chain commitments cannot be reversed by guessing.
 *
 * The slugs match the challenge ids on chain.
 */

export type Widget =
  'query' | 'pad' | 'bruteforce' | 'nullifiers' | 'disclose' | 'merkle' | 'shielded';

export type Paragraph = {
  readonly text: string;
  /** A margin note beside this paragraph. */
  readonly aside?: string;
};

/** One step of the walkthrough, optionally with something to type or paste. */
export type Step = {
  readonly text: string;
  readonly code?: string;
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
  /** How to get from nothing to the answer, without giving the answer away. */
  readonly steps: readonly Step[];
  /** A starting point, not the answer. */
  readonly hint: { readonly language: string; readonly code: string };
  /** What the learner can now say they know. */
  readonly takeaway: string;
};

export const CONSERVE_ADDRESS = 'ecc85abce5e6b1c286eba4f559012ff5ff0cf7bb766dbb35e4cf068b98855a9b';

/** The live Nightschool contract on Preprod; lesson 7 derives its token from it. */
export const NIGHTSCHOOL_ADDRESS =
  'b6b2c5e5348618c64e9e269835088aaea2a633ba94aece3fcd2508253a204c24';

/** The workspace lessons 2–7 share. Set up once, in lesson 2. */
const WORKSPACE_NOTE = 'Use the `nightschool-work` folder you set up in lesson 2.';

const RUN_SCRIPT = `// run.mjs
import { pureCircuits } from './out/contract/index.js';
const hex = (b) => Buffer.from(b).toString('hex');
console.log(hex(pureCircuits.answer()));`;

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
        text: 'GraphQL works like a form you fill in: you name the object you want, then list the fields you want back, nested in braces. Ask for a field that does not exist and the server tells you so, by name. That makes it easy to explore.',
      },
      {
        text: '`contractAction(address: …)` returns the most recent thing that happened to a contract: a deploy, a call or an update. Each action belongs to a transaction, and every transaction has a hash that identifies it on chain.',
        aside: 'Pass `offset` to ask for an older action instead. You will not need it here.',
      },
    ],
    widget: 'query',
    widgetTitle: 'Ask the Preprod indexer',
    task: 'Find the latest action on Conserve’s contract. The answer is its transaction hash.',
    steps: [
      {
        text: 'Press Run query with the box exactly as it is. The `???` is not a real field, so the indexer replies with an error. Read it: it tells you what went wrong.',
      },
      {
        text: 'Ask the schema which fields a transaction has. Replace everything in the box with this and run it:',
        code: '{ __type(name: "Transaction") { fields { name } } }',
      },
      {
        text: 'Look down the list for the field that identifies a transaction. Put the starter query back (reload the page if you need to) and replace `???` with that field.',
      },
      {
        text: 'Run it. The value you get back is 64 hex characters. Paste it below.',
      },
    ],
    hint: {
      language: 'graphql',
      code: `{
  contractAction(address: "${CONSERVE_ADDRESS}") {
    __typename          # ContractCall, ContractDeploy…
    transaction {
      # one field name goes here: the transaction's identifier
    }
  }
}`,
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
        text: 'Compact is the language Midnight contracts are written in. Its circuits compute over private data and publish only what you disclose. The thing most often disclosed is a hash: a 32-byte fingerprint that binds you to a value without revealing it.',
        aside:
          '`persistentHash` is stable across compiler versions, so a hash written today can still be checked years from now.',
      },
      {
        text: 'Hashes in Compact work on fixed-size bytes, so strings are first padded to 32 bytes with `pad(32, "…")`. Type below to see exactly what that means: your text’s UTF-8 bytes, then zeros to fill the rest.',
      },
      {
        text: 'A pure circuit is a function with no access to the chain: same input, same output, every time. You can compile one and call it from JavaScript with no wallet, no node and no proof server. That is the loop for the rest of this course: write a circuit, compile it, call it.',
        aside:
          '`--skip-zk` skips generating proving keys. A pure circuit called from JavaScript never needs them.',
      },
    ],
    widget: 'pad',
    widgetTitle: 'What pad(32, …) does',
    task: 'Compute `persistentHash<Vector<2, Bytes<32>>>` of `[pad(32, "nightschool"), pad(32, "hello midnight")]`. Give the 32 bytes as hex.',
    steps: [
      {
        text: 'Install the Compact toolchain, then select the compiler this course uses. You need Node.js 20 or later too.',
        code: `curl --proto '=https' --tlsv1.2 -LsSf \\
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.31.1`,
      },
      {
        text: 'Make a workspace for the course. The runtime is what compiled circuits import; its version matches the compiler.',
        code: `mkdir nightschool-work && cd nightschool-work
npm init -y && npm pkg set type=module
npm i @midnight-ntwrk/compact-runtime@0.16.0`,
      },
      {
        text: 'Save the circuit from “A place to start” as `answer.compact`, and fill in the two padded strings.',
      },
      {
        text: 'Compile it. This writes JavaScript bindings into `out/`.',
        code: 'compact compile --skip-zk answer.compact out',
      },
      {
        text: 'Save this as `run.mjs` and run `node run.mjs`. It prints your answer.',
        code: RUN_SCRIPT,
      },
    ],
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
    steps: [
      { text: WORKSPACE_NOTE },
      {
        text: 'Replace the body of `answer` in `answer.compact`. `persistentCommit` takes the value first and the salt second; the type in angle brackets is the value’s type.',
      },
      {
        text: 'Compile again and run the same script.',
        code: `compact compile --skip-zk answer.compact out
node run.mjs`,
      },
    ],
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
        text: 'This is exactly how your claims on this page work. Nightschool’s nullifier is a hash of three things: a fixed label, the learner’s secret and the challenge id. The label keeps it from ever colliding with any other hash the contract makes.',
        aside: 'A label like this is called a domain separator.',
      },
    ],
    widget: 'nullifiers',
    widgetTitle: 'Alice, Bob and two challenges',
    task: 'Compute Nightschool’s `claimNullifier` with secret `pad(32, "alice")` and challenge id `pad(32, "first-hash")`. Give it as hex.',
    steps: [
      { text: WORKSPACE_NOTE },
      {
        text: 'Copy Nightschool’s `claimNullifier` circuit, shown in “A place to start”, into `answer.compact` above `answer`. It is the real one from `nightschool.compact`.',
      },
      {
        text: 'Make `answer` call it with Alice’s secret and the challenge id, both padded to 32 bytes. Compile and run as before.',
      },
    ],
    hint: {
      language: 'compact',
      code: `// From nightschool.compact
export pure circuit claimNullifier(secret: Bytes<32>, challengeId: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<3, Bytes<32>>>(
           [pad(32, "nightschool:claim:v1"), secret, challengeId]);
}

export pure circuit answer(): Bytes<32> {
  return claimNullifier(/* secret */, /* challenge id */);
}`,
    },
    takeaway:
      'You can stop double-actions without identifying anyone — the core trick behind private voting, airdrops and this page.',
  },
  {
    slug: 'the-disclose-rule',
    number: 5,
    title: 'The disclose rule',
    concept: 'disclose()',
    hook: 'The compiler will not let you leak a secret by accident. Only on purpose.',
    paragraphs: [
      {
        text: 'A witness is a function a circuit calls to fetch private data from the user’s machine: a secret key, an answer, a path. Witness values go into the proof, never onto the chain. Arguments to an exported circuit are treated the same way, because they come from the user too.',
        aside: 'In Nightschool, `learnerSecret()` and `answerDigest()` are witnesses.',
      },
      {
        text: 'The Compact compiler tracks every value that came from a witness. If one could reach the public side — written to the ledger, returned from an exported circuit, or even used to decide which ledger operation runs — the compiler stops and asks you to say so, by wrapping it in `disclose(…)`.',
      },
      {
        text: 'Hashing a secret does not get you past it. The compiler reports that the ledger “might disclose a hash of the witness value”, because a hash of something guessable is as good as the thing itself. A salted commitment is accepted without `disclose`. Try the three versions below; the messages are the compiler’s own.',
        aside:
          '`disclose` changes nothing at runtime. It is a signature on the line saying “I meant this”.',
      },
      {
        text: 'Nightschool discloses something derived from your secret in exactly one place: enrolment, when your commitment joins the list of learners. After that, every claim discloses only a nullifier.',
      },
    ],
    widget: 'disclose',
    widgetTitle: 'What the compiler says',
    task: 'Bob enrols with secret `pad(32, "bob")`. Compute the value his enrolment discloses: Nightschool’s `learnerCommitment` of his secret. Give it as hex.',
    steps: [
      { text: WORKSPACE_NOTE },
      {
        text: 'Copy `learnerCommitment` from “A place to start” into `answer.compact`. It is the circuit the site runs when you create your student card.',
      },
      {
        text: 'Make `answer` return it for Bob’s secret. Compile and run as before.',
      },
      {
        text: 'Optional, and worth it: add a circuit that stores a witness in a ledger field. Compile, read the error, then add `disclose` and compile again.',
        code: `export ledger stored: Bytes<32>;
witness secret(): Bytes<32>;
export circuit put(): [] {
  stored = secret();   // try: disclose(secret())
}`,
      },
    ],
    hint: {
      language: 'compact',
      code: `// From nightschool.compact
export pure circuit learnerCommitment(secret: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "nightschool:learner:v1"), secret]);
}

export pure circuit answer(): Bytes<32> {
  return learnerCommitment(/* Bob's secret */);
}`,
    },
    takeaway:
      'You know what counts as private in Compact, how the compiler stops it leaking, and how to see exactly what a contract chooses to disclose.',
  },
  {
    slug: 'merkle-membership',
    number: 6,
    title: 'Merkle membership',
    concept: 'Anonymous membership',
    hook: 'One public number can stand for a whole list, and you can prove you are on it without pointing at your name.',
    paragraphs: [
      {
        text: 'A Merkle tree hashes a list pairwise, level by level, until one hash is left: the root. Change any entry and the root changes. So a contract can store just the root and still be committed to every entry.',
      },
      {
        text: 'To show an entry is in the tree, you give the entry and its path: at each level, the hash beside you (the sibling) and which side you are on. Hash your way up. If you arrive at the root, you are in the list.',
        aside:
          'A tree of depth 10, like Nightschool’s, holds 1,024 learners. A path is just 10 siblings.',
      },
      {
        text: 'Here is the trick that makes it private. On Midnight, the path is a witness. The proof says “some path leads from some leaf to this root” and discloses only the root. Nobody learns which leaf. Click a learner below to see what stays hidden.',
      },
      {
        text: 'This is the first thing every Nightschool claim proves: your commitment from lesson 5 is a leaf of the learners tree. The circuit computes the root with `merkleTreePathRoot` and checks it against the roots the contract has seen.',
        aside:
          'The tree is a `HistoricMerkleTree`, so a proof made a moment before someone else enrols still checks out.',
      },
    ],
    widget: 'merkle',
    widgetTitle: 'Four learners, one root',
    task: 'Alice, Bob, Carol and Dave enrolled in that order, each with secret `pad(32, "<name>")`. Bob is leaf 1. Using his path from “A place to start”, compute the tree’s root with `merkleTreePathRoot`. Give `root.field` as 64 hex digits.',
    steps: [
      { text: WORKSPACE_NOTE },
      {
        text: 'Copy the circuit from “A place to start”. Bob’s leaf is his `learnerCommitment`, so keep that circuit from lesson 5. The two sibling digests are given; you supply the leaf.',
      },
      {
        text: '`goes_left` says whether your side of the pair is on the left. At level 0, Alice is on Bob’s left, so Bob is on the right. At level 1, the Alice–Bob pair sits left of Carol–Dave.',
      },
      {
        text: 'The root is a field element: a big integer, not bytes. Print it as hex, zero-padded to 64 digits, with this script.',
        code: `// run.mjs
import { pureCircuits } from './out/contract/index.js';
const root = pureCircuits.answer();          // a bigint
console.log(root.toString(16).padStart(64, '0'));`,
      },
    ],
    hint: {
      language: 'compact',
      code: `export pure circuit answer(): Field {
  const bob = learnerCommitment(pad(32, "bob"));
  const root = merkleTreePathRoot<2, Bytes<32>>(MerkleTreePath<2, Bytes<32>> {
    leaf: /* … */,
    path: [
      MerkleTreePathEntry {
        sibling: MerkleTreeDigest {
          field: 232719615842785020375838993179961091391312673530281863356148719475393189145 as Field
        },
        goes_left: /* is Bob on the left? */
      },
      MerkleTreePathEntry {
        sibling: MerkleTreeDigest {
          field: 1412940405682094929078894632636193671750782618531352969363702905427403354276 as Field
        },
        goes_left: /* is Bob's pair on the left? */
      }
    ]
  });
  return root.field;
}`,
    },
    takeaway:
      'You can prove membership of a set by its root alone, and you know why the proof hides which member you are.',
  },
  {
    slug: 'shielded-tokens',
    number: 7,
    title: 'Shielded tokens',
    concept: 'Value nobody can trace',
    hook: 'A reward everyone can see is a reward everyone can count. A shielded one is yours alone.',
    paragraphs: [
      {
        text: 'Midnight has two kinds of value. Unshielded tokens, like NIGHT, work like coins on most chains: amounts and addresses are public. Shielded tokens live as encrypted coins. The chain checks that no value is created or destroyed, but it cannot see amounts or owners.',
      },
      {
        text: 'A contract can create its own shielded token. Its type, the token’s identity, is a hash of a domain separator the contract picks and the contract’s own address. No other contract can mint the same type, because no other contract has that address.',
        aside: 'In Compact: `tokenType(domainSep, contractAddress)`.',
      },
      {
        text: 'When you claim a lesson, Nightschool calls `mintShieldedToken` and a coin of Night Credits arrives in your wallet. The chain records that a coin was created. It does not record the amount or who received it. Compare the two below.',
        aside:
          'The coin’s nonce is your claim’s nullifier, so no two claims can mint the same coin.',
      },
    ],
    widget: 'shielded',
    widgetTitle: 'What an observer sees',
    task: `Compute the token type of Night Credits: \`tokenType(pad(32, "nightschool:credit:v1"), …)\` for the live Nightschool contract at \`${NIGHTSCHOOL_ADDRESS}\`. Give it as hex.`,
    steps: [
      { text: WORKSPACE_NOTE },
      {
        text: 'A contract address in Compact is a struct holding 32 bytes. Writing 32 bytes as a literal is awkward, so take the address as an argument and pass it in from JavaScript.',
      },
      {
        text: 'Compile, then call `answer` with the address as bytes.',
        code: `// run.mjs
import { pureCircuits } from './out/contract/index.js';
const address = Buffer.from('${NIGHTSCHOOL_ADDRESS}', 'hex');
console.log(Buffer.from(pureCircuits.answer(address)).toString('hex'));`,
      },
      {
        text: 'Once you have claimed a lesson, look for this token type in your wallet. That is your Night Credits.',
      },
    ],
    hint: {
      language: 'compact',
      code: `export pure circuit answer(address: Bytes<32>): Bytes<32> {
  return tokenType(/* domain separator */, ContractAddress { bytes: address });
}`,
    },
    takeaway:
      'You know how a contract mints its own private token, what the chain sees when it does, and how to recognise that token in a wallet.',
  },
];

/** Lessons the curriculum will add, shown dimmed on the map. */
export const COMING: readonly { title: string; concept: string }[] = [
  { title: 'Deploy your own', concept: 'From circuit to contract address' },
  { title: 'Private credentials', concept: 'Prove what you know, not who you are' },
];
