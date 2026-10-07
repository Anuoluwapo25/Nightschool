#!/usr/bin/env node
/**
 * Nightschool CLI — the instructor's tool, and a headless learner for testing.
 *
 * Commands that write need a funded wallet seed and a local proof server;
 * `status` and `check` need neither.
 */

import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import {
  type NetworkProfile,
  type NightschoolDeployment,
  NIGHTSCHOOL_PRIVATE_STATE_ID,
  addChallenge,
  addInvites,
  buildProviders,
  claim,
  contractAddressOf,
  deploy,
  enroll,
  isNetworkProfile,
  join,
  networkConfig,
  publicState,
  readPublicState,
  summarise,
} from '@nightschool/api';
import {
  type NightschoolPrivateState,
  answerMatches,
  challengeIdOf,
  emptyPrivateState,
  fromHex,
  pureCircuits,
  toHex,
} from '@nightschool/contract';
import { deriveAddresses, deriveKeys, seedFromHex } from './keys.js';
import {
  formatUnits,
  openWallet,
  registerForDust,
  summariseWallet,
  waitForSpendableDust,
  waitForSync,
  walletProviders,
} from './wallet.js';

const USAGE = `nightschool — learn Midnight by proving you solved it

Instructor:
  nightschool address                         Show wallet addresses and balances
  nightschool register                        Register NIGHT for DUST generation
  nightschool deploy                          Deploy a fresh Nightschool contract
  nightschool invites --contract <addr> [--batches <n>]
                                              Publish n×8 invites; codes go to instructor/invites.txt
  nightschool challenge --contract <addr> --slug <s> --answer <a> --reward <n>
                                              Publish one challenge (only a commitment goes on chain)
  nightschool seed --contract <addr> --file <challenges.json>
                                              Publish every challenge in a file not yet on chain

Anyone:
  nightschool status --contract <addr>        Public state: challenges, solves, enrolment
  nightschool check --contract <addr> --challenge <s> --answer <a>
                                              Check an answer locally — nothing is sent

Learner (headless):
  nightschool enroll --contract <addr> --invite <code>
  nightschool claim --contract <addr> --challenge <s> --answer <a>

Options:
  --network <preprod|undeployed>              Default: preprod
  --json                                      Machine-readable output

Environment:
  NIGHTSCHOOL_SEED             Hex wallet seed (writes)
  NIGHTSCHOOL_PASSWORD         Encrypts the local private-state store
  NIGHTSCHOOL_INSTRUCTOR_KEY   Hex instructor secret; generated and printed by deploy if unset
  NIGHTSCHOOL_LEARNER_SECRET   Hex learner secret; generated and printed by enroll if unset
  NIGHTSCHOOL_STATE_DIR        Wallet cache directory (default: .nightschool-state)
`;

type Flags = Record<string, string | true>;

const parseArgs = (argv: readonly string[]): { command: string; flags: Flags } => {
  const [command = 'help', ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (!token.startsWith('--')) continue;
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[token.slice(2)] = next;
      i += 1;
    } else {
      flags[token.slice(2)] = true;
    }
  }
  return { command, flags };
};

const required = (flags: Flags, name: string): string => {
  const value = flags[name];
  if (typeof value !== 'string') throw new Error(`missing required option --${name}`);
  return value;
};

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`environment variable ${name} is not set`);
  return value;
};

const profileOf = (flags: Flags): NetworkProfile => {
  const value = flags.network;
  if (value === undefined || value === true) return 'preprod';
  if (!isNetworkProfile(value)) throw new Error(`unknown network "${value}"`);
  return value;
};

const emit = (flags: Flags, human: string, data: Record<string, unknown>): void => {
  console.log(
    flags.json
      ? JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
      : human,
  );
};

/** A secret from the environment, or a fresh one printed once so it can be saved. */
const secretFrom = (name: string, purpose: string): Uint8Array => {
  const configured = process.env[name];
  if (configured) return fromHex(configured);
  const generated = new Uint8Array(randomBytes(32));
  console.error(
    `No ${name} set; generated one. Save it — ${purpose}:\n  export ${name}=${toHex(generated)}\n`,
  );
  return generated;
};

const instructorKey = (): Uint8Array =>
  secretFrom('NIGHTSCHOOL_INSTRUCTOR_KEY', 'without it you cannot add invites or challenges');

const learnerSecret = (): Uint8Array =>
  secretFrom('NIGHTSCHOOL_LEARNER_SECRET', 'it is your identity as a learner');

/** Wallet + providers, for the commands that write to the chain. */
const connect = async (flags: Flags) => {
  const config = networkConfig(profileOf(flags));
  const keys = deriveKeys(seedFromHex(env('NIGHTSCHOOL_SEED')));
  process.stderr.write('syncing wallet…');
  const wallet = await openWallet(config, keys);
  await waitForSync(wallet);
  await wallet.save();
  process.stderr.write(' done\n');
  const providers = buildProviders({
    config,
    wallet: walletProviders(wallet),
    accountId: process.env.NIGHTSCHOOL_ACCOUNT ?? 'default',
    password: () => env('NIGHTSCHOOL_PASSWORD'),
  });
  return { config, wallet, providers };
};

type Connected = Awaited<ReturnType<typeof connect>>;

/**
 * Waits for the wallet to observe its own last transaction before the next.
 *
 * Back-to-back transactions from one process otherwise pick the same DUST coin
 * for their fees — the first spends it, and the node rejects the second as
 * "Invalid Transaction: Custom error: 117".
 */
const BETWEEN_TX_MS = 20_000;
const catchUp = async ({ wallet }: Connected): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, BETWEEN_TX_MS));
  await waitForSync(wallet);
};

const joinAs = async (
  { providers }: Connected,
  contractAddress: string,
  privateState: NightschoolPrivateState,
): Promise<NightschoolDeployment> => {
  providers.privateStateProvider.setContractAddress(contractAddress);
  await providers.privateStateProvider.set(NIGHTSCHOOL_PRIVATE_STATE_ID, privateState);
  return join(providers, contractAddress, privateState);
};

const readState = (flags: Flags) => {
  const config = networkConfig(profileOf(flags));
  return readPublicState(config.indexerUrl, config.indexerWsUrl, required(flags, 'contract'));
};

type ChallengeFile = readonly { slug: string; answer: string; reward: number | string }[];

const commands: Record<string, (flags: Flags) => Promise<void>> = {
  async address(flags) {
    const config = networkConfig(profileOf(flags));
    const keys = deriveKeys(seedFromHex(env('NIGHTSCHOOL_SEED')));
    const addresses = deriveAddresses(keys, config.networkId);
    const wallet = await openWallet(config, keys);
    const balances = await summariseWallet(wallet);
    await wallet.save();
    emit(
      flags,
      `network:   ${config.networkId}\nnight:     ${addresses.night}\n` +
        `shielded:  ${addresses.shielded}\n\nNIGHT:     ${formatUnits(balances.night)}\n` +
        `DUST:      ${formatUnits(balances.dust)}` +
        Object.entries(balances.shielded)
          .map(([token, value]) => `\nshielded ${token.slice(0, 12)}…: ${value}`)
          .join(''),
      { network: config.networkId, ...addresses, ...balances },
    );
    await wallet.close();
  },

  async register(flags) {
    const config = networkConfig(profileOf(flags));
    const wallet = await openWallet(config, deriveKeys(seedFromHex(env('NIGHTSCHOOL_SEED'))));
    await waitForSync(wallet);
    const result = await registerForDust(wallet);
    if (result.status === 'submitted') await waitForSpendableDust(wallet);
    await wallet.save();
    emit(flags, `DUST registration: ${result.status}`, { ...result });
    await wallet.close();
  },

  async deploy(flags) {
    const session = await connect(flags);
    const secret = instructorKey();
    const deployed = await deploy(session.providers, secret);
    const address = contractAddressOf(deployed);
    emit(
      flags,
      `deployed to ${session.config.networkId}\ncontract:   ${address}\n` +
        `instructor: ${toHex(pureCircuits.instructorPublicKey(secret))}\n` +
        `tx:         ${deployed.deployTxData.public.txId}`,
      { network: session.config.networkId, contractAddress: address },
    );
    await session.wallet.close();
  },

  async invites(flags) {
    const session = await connect(flags);
    const contractAddress = required(flags, 'contract');
    const secret = instructorKey();
    const deployment = await joinAs(
      session,
      contractAddress,
      emptyPrivateState({ instructorSecretKey: secret }),
    );
    const batches = Number(typeof flags.batches === 'string' ? flags.batches : '1');
    await mkdir('instructor', { recursive: true });
    const codes: string[] = [];
    for (let b = 0; b < batches; b += 1) {
      const result = await addInvites(session.providers, deployment, secret);
      codes.push(...result.codes);
      await appendFile('instructor/invites.txt', `${result.codes.join('\n')}\n`, { mode: 0o600 });
      process.stderr.write(`batch ${b + 1}/${batches}: tx ${result.txId}\n`);
      if (b + 1 < batches) await catchUp(session);
    }
    emit(flags, `${codes.length} invites published; codes appended to instructor/invites.txt`, {
      codes,
    });
    await session.wallet.close();
  },

  async challenge(flags) {
    const session = await connect(flags);
    const secret = instructorKey();
    const deployment = await joinAs(
      session,
      required(flags, 'contract'),
      emptyPrivateState({ instructorSecretKey: secret }),
    );
    const slug = required(flags, 'slug');
    const result = await addChallenge(
      session.providers,
      deployment,
      secret,
      slug,
      required(flags, 'answer'),
      BigInt(required(flags, 'reward')),
    );
    emit(flags, `challenge "${slug}" published\ntx: ${result.txId}`, { slug, ...result });
    await session.wallet.close();
  },

  async seed(flags) {
    const file = JSON.parse(await readFile(required(flags, 'file'), 'utf8')) as ChallengeFile;
    const session = await connect(flags);
    const contractAddress = required(flags, 'contract');
    const secret = instructorKey();
    const deployment = await joinAs(
      session,
      contractAddress,
      emptyPrivateState({ instructorSecretKey: secret }),
    );
    for (const entry of file) {
      const state = await publicState(session.providers, contractAddress);
      if (state.challenges.member(challengeIdOf(entry.slug))) {
        process.stderr.write(`${entry.slug}: already on chain, skipping\n`);
        continue;
      }
      const result = await addChallenge(
        session.providers,
        deployment,
        secret,
        entry.slug,
        entry.answer,
        BigInt(entry.reward),
      );
      process.stderr.write(`${entry.slug}: published, tx ${result.txId}\n`);
      await catchUp(session);
    }
    emit(flags, 'challenges seeded', { count: file.length });
    await session.wallet.close();
  },

  async status(flags) {
    const view = summarise(await readState(flags));
    emit(
      flags,
      `enrolled learners:    ${view.enrolled}\n` +
        `invites outstanding:  ${view.invitesOutstanding}\n` +
        `total claims:         ${view.totalClaims}\n` +
        `challenges:\n` +
        view.challenges
          .map((c) => `  ${c.slug.padEnd(24)} reward ${c.reward}  solved by ${c.solves}`)
          .join('\n'),
      view,
    );
    process.exit(0);
  },

  async check(flags) {
    const state = await readState(flags);
    const slug = required(flags, 'challenge');
    const ok = await answerMatches(state, challengeIdOf(slug), required(flags, 'answer'));
    emit(flags, ok ? `correct — "${slug}" accepts that answer` : 'not correct', { correct: ok });
    process.exit(ok ? 0 : 1);
  },

  async enroll(flags) {
    const session = await connect(flags);
    const state = emptyPrivateState({ learnerSecret: learnerSecret() });
    const deployment = await joinAs(session, required(flags, 'contract'), state);
    const result = await enroll(session.providers, deployment, state, required(flags, 'invite'));
    emit(flags, `enrolled\ntx: ${result.txId}`, { ...result });
    await session.wallet.close();
  },

  async claim(flags) {
    const session = await connect(flags);
    const state = emptyPrivateState({ learnerSecret: learnerSecret() });
    const deployment = await joinAs(session, required(flags, 'contract'), state);
    const slug = required(flags, 'challenge');
    const result = await claim(
      session.providers,
      deployment,
      state,
      slug,
      required(flags, 'answer'),
    );
    emit(
      flags,
      `claimed "${slug}" — reward minted to your shielded address\ntx: ${result.txId}\n` +
        'On chain: the challenge id and a nullifier. Not on chain: you, or the answer.',
      { slug, ...result },
    );
    await session.wallet.close();
  },

  async help() {
    console.log(USAGE);
  },
};

const main = async (): Promise<void> => {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const handler = commands[command];
  if (!handler) {
    console.error(`unknown command "${command}"\n`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  await handler(flags);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith('nightschool:') ? message : `nightschool: ${message}`);
  // An open wallet keeps its indexer sockets alive, so a failed command would
  // otherwise hang instead of exiting.
  process.exit(1);
});
