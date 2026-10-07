import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEPLOYED_CONTRACT, networkConfig } from '@nightschool/api/config';
import {
  ClaimRefused,
  claim as claimOnChain,
  enroll as enrollOnChain,
  join,
  preflightClaim,
  readPublicState,
} from '@nightschool/api/nightschool';
import { type PublicView, summarise } from '@nightschool/api/view';
import {
  type Ledger,
  answerDigestOf,
  answerMatches,
  challengeIdOf,
  emptyPrivateState,
  fromHex,
  hasClaimed,
  isEnrolled,
  pureCircuits,
  toHex,
} from '@nightschool/contract';
import { LESSONS, type Lesson } from './lessons.js';
import { createSecret, forgetSecret, loadSecret } from './learner.js';
import {
  type AvailableWallet,
  type WalletSession,
  availableWallets,
  browserProviders,
  connectWallet,
  ensureConnected,
} from './wallet.js';

const NETWORK = networkConfig('preprod');
const POLL_MS = 20_000;

const contractAddress = (): string | undefined => {
  const fromQuery = new URLSearchParams(window.location.search).get('contract');
  return fromQuery ?? DEPLOYED_CONTRACT.preprod;
};

const lessonOrder = (slug: string): number => {
  const index = LESSONS.findIndex((lesson) => lesson.slug === slug);
  return index === -1 ? LESSONS.length : index;
};

const short = (hex: string, n = 8): string => `${hex.slice(0, n)}…${hex.slice(-4)}`;

type Trace = {
  readonly title: string;
  readonly publicRows: readonly (readonly [string, string])[];
  readonly privateRows: readonly (readonly [string, string])[];
  readonly txId?: string;
};

type Busy = { readonly label: string; readonly step: string } | undefined;

export default function App() {
  const address = contractAddress();
  const [state, setState] = useState<Ledger>();
  const [loadError, setLoadError] = useState<string>();
  const [secret, setSecret] = useState<Uint8Array | undefined>(() => loadSecret());
  const [wallets, setWallets] = useState<AvailableWallet[]>([]);
  const [session, setSession] = useState<WalletSession>();
  const [proofServer, setProofServer] = useState('http://127.0.0.1:6300');
  const [busy, setBusy] = useState<Busy>();
  const [error, setError] = useState<string>();
  const [trace, setTrace] = useState<Trace>();
  const [walletLocked, setWalletLocked] = useState(false);

  const refresh = useCallback(async () => {
    if (address === undefined) return;
    try {
      setState(await readPublicState(NETWORK.indexerUrl, NETWORK.indexerWsUrl, address));
      setLoadError(undefined);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [address]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Wallet extensions inject themselves a moment after the page loads.
  useEffect(() => {
    const scan = () => setWallets(availableWallets());
    scan();
    const timer = setTimeout(scan, 1200);
    return () => clearTimeout(timer);
  }, []);

  const view: PublicView | undefined = useMemo(
    () => (state ? summarise(state) : undefined),
    [state],
  );
  const enrolled = state !== undefined && secret !== undefined && isEnrolled(state, secret);

  /** Runs a chain step with a wallet, the learner's proof server and a fresh join. */
  const withContract = async <T,>(
    label: string,
    run: (ctx: {
      providers: Awaited<ReturnType<typeof browserProviders>>;
      deployment: Awaited<ReturnType<typeof join>>;
      learner: ReturnType<typeof emptyPrivateState>;
      step: (s: string) => void;
    }) => Promise<T>,
  ): Promise<T | undefined> => {
    if (address === undefined || session === undefined || secret === undefined) return undefined;
    setError(undefined);
    const step = (s: string) => setBusy({ label, step: s });
    try {
      step('Checking your wallet and proof server');
      const live = await ensureConnected(session);
      setSession(live);
      const providers = await browserProviders(live, toHex(secret), proofServer, setWalletLocked);
      providers.privateStateProvider.setContractAddress(address);
      const learner = emptyPrivateState({ learnerSecret: secret });
      step('Joining the contract');
      const deployment = await join(providers, address, learner);
      return await run({ providers, deployment, learner, step });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    } finally {
      setBusy(undefined);
      void refresh();
    }
  };

  const enroll = async (invite: string) => {
    const result = await withContract(
      'Enrolling',
      async ({ providers, deployment, learner, step }) => {
        step('Proving on your machine, then asking your wallet to pay the fee');
        return enrollOnChain(providers, deployment, learner, invite.trim());
      },
    );
    if (result && secret) {
      setTrace({
        title: 'Enrolled',
        txId: result.txId,
        publicRows: [
          ['Invite redeemed', short(toHex(pureCircuits.inviteHash(fromHex(invite.trim()))), 12)],
          ['Your enrolment commitment', short(toHex(pureCircuits.learnerCommitment(secret)), 12)],
        ],
        privateRows: [
          ['Your learner secret', 'stays in this browser'],
          [
            'Link from enrolment to future claims',
            'none — claims prove membership, not which member',
          ],
        ],
      });
    }
  };

  const claim = async (lesson: Lesson, answer: string) => {
    const result = await withContract(
      'Claiming',
      async ({ providers, deployment, learner, step }) => {
        step('Checking your answer locally');
        if (state) await preflightClaim(state, learner, lesson.slug, answer);
        step('Proving you know the answer — this runs on your machine');
        return claimOnChain(providers, deployment, learner, lesson.slug, answer);
      },
    );
    if (result && secret) {
      setTrace({
        title: `Claimed “${lesson.title}”`,
        txId: result.txId,
        publicRows: [
          ['Challenge', lesson.slug],
          [
            'Nullifier',
            short(toHex(pureCircuits.claimNullifier(secret, challengeIdOf(lesson.slug))), 12),
          ],
          ['Reward', 'a shielded coin — amount and owner hidden'],
        ],
        privateRows: [
          ['Your answer', 'never left this browser'],
          ['Answer digest', short(toHex(await answerDigestOf(answer)), 12) + ' (local only)'],
          ['Which learner you are', 'hidden among all enrolled learners'],
        ],
      });
    }
  };

  const connect = async (wallet: AvailableWallet) => {
    setError(undefined);
    try {
      setSession(await connectWallet(wallet, NETWORK.networkId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="page">
      <Header live={state !== undefined} />

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A school for Midnight, built on Midnight</p>
          <h1>
            Learn Midnight by <em>proving</em> it.
          </h1>
          <p className="lede">
            Solve real challenges on Preprod. Your answer is checked in zero knowledge and never
            touches the chain — so it can’t be copied, and one learner can’t farm rewards with fifty
            wallets.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#lessons">
              Start lesson 01
            </a>
            <a className="button ghost" href="#how">
              How it works
            </a>
          </div>
        </div>
        <Problem />
      </section>

      <Board view={view} loadError={loadError} address={address} />

      <div className="workspace" id="lessons">
        <main className="lessons">
          <h2 className="section-title">Lessons</h2>
          {LESSONS.map((lesson) => (
            <LessonCard
              key={lesson.slug}
              lesson={lesson}
              state={state}
              secret={secret}
              enrolled={enrolled}
              canClaim={session !== undefined && enrolled && busy === undefined}
              onClaim={claim}
            />
          ))}
        </main>

        <aside className="sidebar">
          <LearnerPanel
            secret={secret}
            enrolled={enrolled}
            state={state}
            session={session}
            wallets={wallets}
            proofServer={proofServer}
            busy={busy}
            onCreate={() => setSecret(createSecret())}
            onForget={() => {
              forgetSecret();
              setSecret(undefined);
            }}
            onConnect={connect}
            onProofServer={setProofServer}
            onEnroll={enroll}
          />
          {busy && (
            <div className="card busy" role="status">
              <span className="spinner" aria-hidden />
              <div>
                <strong>{busy.label}</strong>
                <p>{busy.step}</p>
                {walletLocked && (
                  <p className="warn">Your wallet locked itself — unlock it to continue.</p>
                )}
              </div>
            </div>
          )}
          {error && (
            <div className="card error" role="alert">
              <strong>That didn’t go through</strong>
              <p>{error}</p>
              <button className="link" onClick={() => setError(undefined)}>
                Dismiss
              </button>
            </div>
          )}
          {trace && <TraceCard trace={trace} onClose={() => setTrace(undefined)} />}
        </aside>
      </div>

      <HowItWorks />
      <footer className="footer">
        <span>Nightschool · open source · Midnight Preprod</span>
        {address && <span className="mono">contract {short(address, 10)}</span>}
      </footer>
    </div>
  );
}

function Header({ live }: { live: boolean }) {
  return (
    <header className="header">
      <a className="brand" href="#">
        <svg viewBox="0 0 32 32" aria-hidden width="28" height="28">
          <circle cx="16" cy="16" r="15" className="brand-disc" />
          <path d="M20 8a9 9 0 1 0 4 15A10 10 0 0 1 20 8z" className="brand-moon" />
        </svg>
        Nightschool
      </a>
      <nav>
        <a href="#board">Board</a>
        <a href="#lessons">Lessons</a>
        <a href="#how">How it works</a>
      </nav>
      <span className={`pill ${live ? 'ok' : ''}`}>
        <span className="dot" aria-hidden />
        {live ? 'Preprod · live' : 'Preprod'}
      </span>
    </header>
  );
}

function Problem() {
  return (
    <div className="compare card">
      <div>
        <p className="compare-label bad">Learn-to-earn on a public chain</p>
        <ul>
          <li>The first correct answer is readable in its transaction. Everyone copies it.</li>
          <li>One person, fifty wallets, fifty rewards.</li>
          <li>Fixes need KYC — and a database of who learned what.</li>
        </ul>
      </div>
      <div>
        <p className="compare-label good">Nightschool on Midnight</p>
        <ul>
          <li>You prove you know the answer. The answer is never published.</li>
          <li>One invite, one learner, one claim per challenge — from any wallet.</li>
          <li>No one, not even the instructor, can tell which learner solved what.</li>
        </ul>
      </div>
    </div>
  );
}

function Board({
  view,
  loadError,
  address,
}: {
  view: PublicView | undefined;
  loadError: string | undefined;
  address: string | undefined;
}) {
  return (
    <section className="board" id="board">
      <div className="board-head">
        <h2 className="section-title">Live on Preprod</h2>
        <p className="muted">
          Read straight from the public indexer. This is everything the chain knows — note what is
          missing.
        </p>
      </div>
      {address === undefined ? (
        <p className="muted">No contract configured.</p>
      ) : loadError ? (
        <p className="muted">Couldn’t reach the indexer: {loadError}</p>
      ) : view === undefined ? (
        <div className="stats skeleton">
          <div />
          <div />
          <div />
        </div>
      ) : (
        <>
          <div className="stats">
            <Stat value={view.enrolled} label="enrolled learners" />
            <Stat value={view.totalClaims} label="private claims" />
            <Stat value={view.invitesOutstanding} label="invites left" />
          </div>
          <div className="table card">
            <div className="row head">
              <span>Challenge</span>
              <span>Answer on chain</span>
              <span className="num">Reward</span>
              <span className="num">Solved by</span>
            </div>
            {[...view.challenges]
              .sort((a, b) => lessonOrder(a.slug) - lessonOrder(b.slug))
              .map((c) => (
                <div className="row" key={c.id}>
                  <span className="mono">{c.slug}</span>
                  <span className="mono muted" title={c.answerCommitment}>
                    commitment {short(c.answerCommitment, 10)}
                  </span>
                  <span className="num">{String(c.reward)} NC</span>
                  <span className="num">{String(c.solves)}</span>
                </div>
              ))}
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ value, label }: { value: bigint; label: string }) {
  return (
    <div className="stat card">
      <span className="stat-value">{String(value)}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

type CheckResult = 'correct' | 'wrong' | 'claimed' | undefined;

function LessonCard({
  lesson,
  state,
  secret,
  enrolled,
  canClaim,
  onClaim,
}: {
  lesson: Lesson;
  state: Ledger | undefined;
  secret: Uint8Array | undefined;
  enrolled: boolean;
  canClaim: boolean;
  onClaim: (lesson: Lesson, answer: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(lesson.number === '01');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<CheckResult>();
  const id = challengeIdOf(lesson.slug);
  const claimed = state !== undefined && secret !== undefined && hasClaimed(state, secret, id);
  const live = state?.challenges.member(id) ?? false;

  const check = async () => {
    if (!state) return;
    setResult((await answerMatches(state, id, answer)) ? 'correct' : 'wrong');
  };

  return (
    <article className={`lesson card ${open ? 'open' : ''}`}>
      <button className="lesson-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="lesson-num">{lesson.number}</span>
        <span className="lesson-title">
          <strong>{lesson.title}</strong>
          <span className="muted">{lesson.concept}</span>
        </span>
        {claimed ? (
          <span className="badge done">Claimed</span>
        ) : (
          live && <span className="badge">{String(state?.rewards.lookup(id) ?? 0n)} NC</span>
        )}
        <span className="chev" aria-hidden>
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div className="lesson-body">
          {lesson.body.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
          <div className="task">
            <span className="task-label">Your task</span>
            <p>{lesson.task}</p>
          </div>
          <pre className="code" data-lang={lesson.hint.language}>
            <code>{lesson.hint.code}</code>
          </pre>
          <label className="answer">
            <span>Your answer</span>
            <input
              className="mono"
              placeholder="64 hex characters"
              value={answer}
              onChange={(e) => {
                setAnswer(e.target.value);
                setResult(undefined);
              }}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <div className="answer-actions">
            <button className="button" disabled={!state || answer.trim() === ''} onClick={check}>
              Check privately
            </button>
            <button
              className="button primary"
              disabled={!canClaim || result !== 'correct' || claimed}
              onClick={() => void onClaim(lesson, answer)}
              title={
                !enrolled
                  ? 'Enrol with an invite first'
                  : !canClaim
                    ? 'Connect a wallet first'
                    : undefined
              }
            >
              Claim reward
            </button>
          </div>
          {result === 'correct' && (
            <p className="result good">
              Correct. Checked in this browser against the on-chain commitment — nothing was sent.
              {!enrolled && ' Enrol with an invite to claim the reward.'}
            </p>
          )}
          {result === 'wrong' && (
            <p className="result bad">
              Not quite. Your guess stayed in this browser; nobody saw it.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function LearnerPanel({
  secret,
  enrolled,
  state,
  session,
  wallets,
  proofServer,
  busy,
  onCreate,
  onForget,
  onConnect,
  onProofServer,
  onEnroll,
}: {
  secret: Uint8Array | undefined;
  enrolled: boolean;
  state: Ledger | undefined;
  session: WalletSession | undefined;
  wallets: AvailableWallet[];
  proofServer: string;
  busy: Busy;
  onCreate: () => void;
  onForget: () => void;
  onConnect: (wallet: AvailableWallet) => void;
  onProofServer: (url: string) => void;
  onEnroll: (invite: string) => void;
}) {
  const [invite, setInvite] = useState('');
  const solved =
    state && secret
      ? LESSONS.filter((l) => hasClaimed(state, secret, challengeIdOf(l.slug))).length
      : 0;

  const backup = () => {
    if (!secret) return;
    const blob = new Blob([`${toHex(secret)}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nightschool-learner-secret.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card learner">
      <h3>You</h3>
      <ol className="steps">
        <li className={secret ? 'done' : 'current'}>
          <span className="step-title">Create a learner identity</span>
          {secret ? (
            <span className="muted small">
              Secret kept in this browser ·{' '}
              <button className="link" onClick={backup}>
                back up
              </button>{' '}
              ·{' '}
              <button className="link" onClick={onForget}>
                forget
              </button>
            </span>
          ) : (
            <button className="button small" onClick={onCreate}>
              Create identity
            </button>
          )}
        </li>

        <li className={session ? 'done' : secret ? 'current' : ''}>
          <span className="step-title">Connect a Midnight wallet</span>
          {session ? (
            <span className="muted small mono">{short(session.shieldedAddress, 18)}</span>
          ) : wallets.length === 0 ? (
            <span className="muted small">
              Install Lace (Midnight) and switch it to Preprod. You can check answers without one.
            </span>
          ) : (
            <div className="wallets">
              {wallets.map((w) => (
                <button
                  key={w.id}
                  className="button small"
                  disabled={!w.supported}
                  onClick={() => onConnect(w)}
                >
                  {w.api.name}
                </button>
              ))}
            </div>
          )}
          <label className="field small">
            <span>Proof server (runs on your machine)</span>
            <input
              className="mono"
              value={proofServer}
              onChange={(e) => onProofServer(e.target.value)}
            />
          </label>
        </li>

        <li className={enrolled ? 'done' : secret && session ? 'current' : ''}>
          <span className="step-title">Enrol with an invite</span>
          {enrolled ? (
            <span className="muted small">
              Enrolled · {solved}/{LESSONS.length} claimed
            </span>
          ) : (
            <div className="invite">
              <input
                className="mono"
                placeholder="invite code"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                spellCheck={false}
              />
              <button
                className="button small primary"
                disabled={
                  !secret ||
                  !session ||
                  busy !== undefined ||
                  !/^[0-9a-fA-F]{64}$/.test(invite.trim())
                }
                onClick={() => onEnroll(invite)}
              >
                Enrol
              </button>
            </div>
          )}
        </li>
      </ol>
    </div>
  );
}

function TraceCard({ trace, onClose }: { trace: Trace; onClose: () => void }) {
  return (
    <div className="card trace">
      <div className="trace-head">
        <strong>{trace.title}</strong>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="trace-label pub">What the chain saw</p>
      <dl>
        {trace.publicRows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="trace-label priv">What stayed with you</p>
      <dl>
        {trace.privateRows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {trace.txId && <p className="muted small mono">tx {short(trace.txId, 16)}</p>}
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="how" id="how">
      <h2 className="section-title">How it works</h2>
      <div className="how-grid">
        <div className="card">
          <span className="how-num">1</span>
          <h3>The instructor commits</h3>
          <p>
            Each challenge goes on chain as <code>hash(challenge, sha256(answer))</code>. The answer
            itself never does. Invites go on chain as hashes; the codes are handed out at a workshop
            or bootcamp.
          </p>
        </div>
        <div className="card">
          <span className="how-num">2</span>
          <h3>You enrol once</h3>
          <p>
            Redeeming an invite adds <code>hash(your secret)</code> to a Merkle tree of learners.
            The invite is spent, so one invite is one learner, whatever number of wallets they own.
          </p>
        </div>
        <div className="card">
          <span className="how-num">3</span>
          <h3>You prove, privately</h3>
          <p>
            A claim proves three things in zero knowledge: you are <em>some</em> leaf in that tree,
            your answer matches the commitment, and your nullifier for this challenge is fresh. The
            chain learns the challenge and the nullifier. Nothing else.
          </p>
        </div>
        <div className="card">
          <span className="how-num">4</span>
          <h3>You get paid, shielded</h3>
          <p>
            The reward — Night Credits — is minted as a shielded coin to your wallet. Nobody can see
            who earned what, so a learning record can’t be scraped or used against you.
          </p>
        </div>
      </div>
      <p className="muted honest">
        Honest limits: a learner can still tell a friend the answer off chain — Nightschool stops
        on-chain copying and reward farming, not conversation. Answers are high-entropy values
        (hashes, transaction ids) so their commitments can’t be brute-forced.
      </p>
    </section>
  );
}
