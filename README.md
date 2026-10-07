# Nightschool

**Learn Midnight by solving challenges on it. Your answer is proved in zero
knowledge and never reaches the chain, so it can't be copied, and one learner
can't farm rewards with fifty wallets.**

**Live site: [nightschool-zeta.vercel.app](https://nightschool-zeta.vercel.app)** — on Midnight Preprod.

## The problem

Learn-to-earn platforms on public chains break in two predictable ways:

1. **Answers leak.** The first correct answer is readable in its own
   transaction. Everyone after that copies it instead of learning, and bots
   drain the rewards within hours.
2. **One person, many wallets.** A reward meant for one learner is claimed fifty
   times from fifty addresses.

The usual fixes are a centralised answer checker and KYC. That means a database
recording who learned what, and a server everyone has to trust.

## What Nightschool does instead

|                | Public chain              | Nightschool on Midnight                         |
| -------------- | ------------------------- | ----------------------------------------------- |
| The answer     | Published in the claim tx | Never leaves the learner's browser              |
| Who claimed    | Their address, forever    | Hidden among all enrolled learners              |
| Claiming twice | Use another wallet        | Same nullifier from any wallet, so it's refused |
| The reward     | A visible transfer        | A shielded coin; amount and owner hidden        |

A claim proves three things in one zero-knowledge proof:

- **"I'm enrolled."** The learner's commitment is _some_ leaf of the on-chain
  Merkle tree of learners. The proof doesn't reveal which leaf.
- **"I know the answer."** `hash(challengeId, sha256(answer))` equals the
  commitment the instructor published.
- **"I haven't claimed this before."** A nullifier
  `hash(learnerSecret, challengeId)` is fresh. The same learner always produces
  the same nullifier, whatever wallet submits the claim.

The chain learns the challenge id and the nullifier. Not the answer, not the
learner, and not the link between this claim and their enrolment or their
other claims. The instructor doesn't learn these either.

Enrolment uses one-time invite codes, handed out by whoever runs the cohort (a
bootcamp, a workshop, a university course). Only the codes' hashes go on chain,
and redeeming a code spends it.

## Try it

**Check an answer with no wallet.** Open the site, read lesson 01 and paste an
answer into _Check privately_. Your browser compares it with the on-chain
commitment. Nothing is sent anywhere.

**Claim a reward on Preprod.** You need:

- [Lace](https://www.lace.io/) with Midnight enabled, set to Preprod
- A local proof server:

  ```bash
  docker run -d --rm -p 6300:6300 midnightntwrk/proof-server:8.1.0 -- \
    'midnight-proof-server --port 6300'
  ```

- An invite code (ask the cohort organizer)

Then: create an identity, connect the wallet, enrol, solve, claim.

## Live deployment

|            |                                                                      |
| ---------- | -------------------------------------------------------------------- |
| Network    | Midnight Preprod                                                     |
| Contract   | `b6b2c5e5348618c64e9e269835088aaea2a633ba94aece3fcd2508253a204c24`   |
| Deploy tx  | `00e1af9fd64bb87498e1058c48258ffdd57238a1e30c997cc48db8d5924ed84b30` |
| Challenges | 4 published, answers committed                                       |
| Invites    | 24 published                                                         |

```bash
nightschool status --contract b6b2c5e5348618c64e9e269835088aaea2a633ba94aece3fcd2508253a204c24
```

## Curriculum

| #   | Lesson          | Midnight concept           | Answer is…           |
| --- | --------------- | -------------------------- | -------------------- |
| 01  | Read the ledger | Public state, the indexer  | A transaction hash   |
| 02  | Your first hash | `persistentHash`           | A 32-byte hash       |
| 03  | Commit and hide | `persistentCommit`         | A 32-byte commitment |
| 04  | Nullifiers      | Spend once, stay anonymous | A nullifier          |

Every answer is the 32-byte output of real work. That matters because the
answer's commitment is public. A low-entropy answer like "42" or "yes" could be
recovered by hashing guesses, but a hash or a transaction id can't be.

## Repository

```
packages/
  contract/   nightschool.compact, witnesses, simulator, tests
  api/        deploy / invites / challenges / enrol / claim workflows (Node + browser)
  cli/        instructor tool and headless learner
  ui/         the site: lessons, live board, private check, wallet claims
```

```bash
npm install
npm test        # compiles the contract and runs the circuit tests in-process
npm run build
npm run dev -w @nightschool/ui
```

### Running a cohort (instructor)

```bash
export NIGHTSCHOOL_SEED=…  NIGHTSCHOOL_PASSWORD=…  NIGHTSCHOOL_INSTRUCTOR_KEY=…
nightschool deploy
nightschool invites --contract <addr> --batches 4      # codes → instructor/invites.txt
nightschool seed --contract <addr> --file instructor/challenges.json
nightschool status --contract <addr>
```

`instructor/` is gitignored. It holds the answers and invite codes, and only
their hashes ever go on chain.

## Honest limits

- **Answers can still be shared outside the chain.** Nightschool stops on-chain
  copying and reward farming. It can't stop one learner telling another the
  answer. A per-learner challenge variant is on the roadmap.
- **Sybil resistance is only as strong as invite distribution.** One invite is
  one learner. Whoever hands out invites decides what "one person" means.
- **Proving needs a local proof server.** The proof is built from the learner's
  secret and answer, so a hosted prover would see both.

## Roadmap

- **Private skills credential:** prove "solved ≥ k challenges" to an employer
  without revealing which ones or who you are.
- **Per-learner challenges**, so that sharing an answer doesn't help anyone else.
- **Instructor dashboard** for creating challenges and invites from the browser.
- **More lessons:** disclosure rules, Merkle proofs, shielded tokens, and
  deploying your own contract.

## License

Apache-2.0
