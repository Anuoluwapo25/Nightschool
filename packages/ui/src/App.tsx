import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEPLOYED_CONTRACT, networkConfig } from '@nightschool/api/config';
import {
  claim as claimOnChain,
  enroll as enrollOnChain,
  join,
  preflightClaim,
  readPublicState,
} from '@nightschool/api/nightschool';
import { type PublicView, summarise } from '@nightschool/api/view';
import {
  type Ledger,
  challengeIdOf,
  emptyPrivateState,
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
import { CourseMap, type Progress } from './components/CourseMap.js';
import { type ClaimReceipt, LessonPage } from './components/LessonPage.js';
import { StudentCard } from './components/StudentCard.js';
import { LampIcon, MoonIcon } from './components/Boundary.js';

const NETWORK = networkConfig('preprod');
const POLL_MS = 20_000;
const SOLVED_KEY = 'nightschool:solved';

const contractAddress = (): string | undefined =>
  new URLSearchParams(window.location.search).get('contract') ?? DEPLOYED_CONTRACT.preprod;

/** `#/lesson/2` → 2; anything else is the course page. */
const routeLesson = (): number => {
  const match = /^#\/lesson\/(\d+)/.exec(window.location.hash);
  return match ? Number(match[1]) : 0;
};

const loadSolved = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SOLVED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};

type Busy = { readonly label: string; readonly step: string } | undefined;

export default function App() {
  const address = contractAddress();
  const [lessonNumber, setLessonNumber] = useState(routeLesson);
  const [state, setState] = useState<Ledger>();
  const [loadError, setLoadError] = useState<string>();
  const [secret, setSecret] = useState<Uint8Array | undefined>(() => loadSecret());
  const [solved, setSolved] = useState<Set<string>>(loadSolved);
  const [wallets, setWallets] = useState<AvailableWallet[]>([]);
  const [session, setSession] = useState<WalletSession>();
  const [proofServer, setProofServer] = useState('http://127.0.0.1:6300');
  const [busy, setBusy] = useState<Busy>();
  const [error, setError] = useState<string>();
  const [receipt, setReceipt] = useState<ClaimReceipt>();
  const [walletLocked, setWalletLocked] = useState(false);

  useEffect(() => {
    const onHash = () => setLessonNumber(routeLesson());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const open = (n: number) => {
    window.location.hash = n === 0 ? '#/' : `#/lesson/${n}`;
    if (n === 0) window.scrollTo({ top: 0 });
  };

  const showCard = () => {
    if (lessonNumber !== 0) open(0);
    setTimeout(() => document.getElementById('card')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

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
  const claimedCount =
    state && secret
      ? LESSONS.filter((l) => hasClaimed(state, secret, challengeIdOf(l.slug))).length
      : 0;

  const progress = (slug: string): Progress =>
    state && secret && hasClaimed(state, secret, challengeIdOf(slug))
      ? 'claimed'
      : solved.has(slug)
        ? 'solved'
        : 'new';

  const markSolved = (slug: string) => {
    const next = new Set(solved).add(slug);
    setSolved(next);
    try {
      localStorage.setItem(SOLVED_KEY, JSON.stringify([...next]));
    } catch {
      // Progress is a convenience; losing it costs nothing on chain.
    }
  };

  /** Runs a chain step with the wallet, the learner's proof server and a fresh join. */
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

  const enroll = (invite: string) =>
    void withContract('Enrolling', async ({ providers, deployment, learner, step }) => {
      step('Proving on your machine, then asking your wallet to pay the fee');
      return enrollOnChain(providers, deployment, learner, invite.trim());
    });

  const claim = (lesson: Lesson, answer: string) =>
    void withContract('Claiming', async ({ providers, deployment, learner, step }) => {
      step('Checking your answer under the lamp');
      if (state) await preflightClaim(state, learner, lesson.slug, answer);
      step('Proving you know the answer — on your machine, not ours');
      const result = await claimOnChain(providers, deployment, learner, lesson.slug, answer);
      setReceipt({
        slug: lesson.slug,
        txId: result.txId,
        nullifier: toHex(
          pureCircuits.claimNullifier(learner.learnerSecret, challengeIdOf(lesson.slug)),
        ),
      });
      return result;
    });

  const connect = async (wallet: AvailableWallet) => {
    setError(undefined);
    try {
      setSession(await connectWallet(wallet, NETWORK.networkId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const lesson = LESSONS.find((l) => l.number === lessonNumber);

  return (
    <div className="shell">
      <header className="masthead">
        <button className="wordmark" onClick={() => open(0)}>
          Nightschool
        </button>
        <span className="masthead-sub">
          a night course in private computation, taught on Midnight
        </span>
        <button className="seat" onClick={showCard} aria-label="Your student card">
          <span className={`seat-dot ${enrolled ? 'on' : secret ? 'half' : ''}`} />
          {enrolled
            ? `${claimedCount}/${LESSONS.length} claimed`
            : secret
              ? 'Not enrolled'
              : 'No card'}
        </button>
      </header>

      {lesson ? (
        <LessonPage
          lesson={lesson}
          state={state}
          secret={secret}
          enrolled={enrolled}
          walletReady={session !== undefined}
          busy={busy !== undefined}
          receipt={receipt}
          onSolved={markSolved}
          onClaim={claim}
          onOpen={open}
          onCard={showCard}
        />
      ) : (
        <main className="course">
          <section className="intro">
            <h1>
              Learn Midnight
              <br />
              by <em>proving</em> it.
            </h1>
            <div className="intro-copy">
              <p>
                Four short lessons on the ideas behind private smart contracts — each one practised
                on the real Midnight network. When you solve one, you prove it in zero knowledge:
                your answer never leaves this page, so nobody can copy it, and nobody can tell who
                solved what.
              </p>
              <ul className="legend">
                <li>
                  <span className="legend-lamp">
                    <LampIcon /> Lamplight
                  </span>
                  stays on your machine — your answers, your secret.
                </li>
                <li>
                  <span className="legend-moon">
                    <MoonIcon /> Moonlight
                  </span>
                  is the public chain — only fingerprints and proofs.
                </li>
              </ul>
              <button className="btn lamp big" onClick={() => open(nextLesson(progress))}>
                {solved.size === 0
                  ? 'Begin lesson 1'
                  : `Continue with lesson ${nextLesson(progress)}`}
              </button>
            </div>
          </section>

          <CourseMap progress={progress} onOpen={open} />

          <section className="lower">
            <div id="card">
              <h2>Your student card</h2>
              <StudentCard
                secret={secret}
                enrolled={enrolled}
                solved={claimedCount}
                total={LESSONS.length}
                session={session}
                wallets={wallets}
                proofServer={proofServer}
                busy={busy !== undefined}
                onCreate={() => setSecret(createSecret())}
                onForget={() => {
                  forgetSecret();
                  setSecret(undefined);
                }}
                onConnect={(w) => void connect(w)}
                onProofServer={setProofServer}
                onEnroll={enroll}
              />
              <p className="small muted card-note">
                You can do every lesson without a card. The card is for putting your progress on
                chain — privately — and earning Night Credits.
              </p>
            </div>
            <PublicRecord view={view} loadError={loadError} address={address} />
          </section>

          <section className="why">
            <h2>Why a school needs to be private</h2>
            <div className="why-grid">
              <p>
                <strong>On a public chain, the first right answer is everyone’s.</strong> It sits in
                the transaction for anyone to copy, and bots drain the rewards within hours.
              </p>
              <p>
                <strong>One person, fifty wallets.</strong> Rewards meant for learners go to whoever
                runs the most addresses — unless you collect IDs, and a database of who learned
                what.
              </p>
              <p>
                <strong>Here, both are closed by proofs.</strong> An answer is checked against a
                commitment, a student is proved to be one of the enrolled without saying which, and
                a nullifier stops anyone claiming twice from any wallet.
              </p>
            </div>
          </section>
        </main>
      )}

      {(busy || error) && (
        <div className="toast" role={error ? 'alert' : 'status'}>
          {busy && (
            <>
              <span className="spinner" aria-hidden />
              <div>
                <strong>{busy.label}</strong>
                <p>{busy.step}</p>
                {walletLocked && (
                  <p className="warn">Your wallet locked itself — unlock it to go on.</p>
                )}
              </div>
            </>
          )}
          {error && !busy && (
            <div>
              <strong>That did not go through</strong>
              <p>{error}</p>
              <button className="link" onClick={() => setError(undefined)}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      <footer className="colophon">
        <span>Nightschool is open source · Midnight Preprod</span>
        <a href="https://github.com/Anuoluwapo25/Nightschool">Source</a>
      </footer>
    </div>
  );
}

const nextLesson = (progress: (slug: string) => Progress): number =>
  (LESSONS.find((l) => progress(l.slug) === 'new') ?? LESSONS[0]!).number;

function PublicRecord({
  view,
  loadError,
  address,
}: {
  view: PublicView | undefined;
  loadError: string | undefined;
  address: string | undefined;
}) {
  return (
    <div className="record">
      <h2>
        <MoonIcon /> The public record
      </h2>
      <p className="small muted">
        Everything the chain knows about this school, read live. Notice what is not here: no names,
        no answers, no link between a student and a lesson.
      </p>
      {loadError ? (
        <p className="small muted">Could not reach the indexer: {loadError}</p>
      ) : !view ? (
        <p className="small muted">Reading Preprod…</p>
      ) : (
        <div className="register">
          <div className="register-line">
            <span>Students enrolled</span>
            <span className="dots" />
            <span>{String(view.enrolled)}</span>
          </div>
          <div className="register-line">
            <span>Private claims</span>
            <span className="dots" />
            <span>{String(view.totalClaims)}</span>
          </div>
          <div className="register-line">
            <span>Invites unspent</span>
            <span className="dots" />
            <span>{String(view.invitesOutstanding)}</span>
          </div>
          <p className="register-head">Solved by, per lesson</p>
          {LESSONS.map((l) => {
            const c = view.challenges.find((x) => x.slug === l.slug);
            return (
              <div className="register-line" key={l.slug}>
                <span>
                  {String(l.number).padStart(2, '0')} {l.title}
                </span>
                <span className="dots" />
                <span>{c ? String(c.solves) : '—'}</span>
              </div>
            );
          })}
          {address && <p className="register-foot mono">contract {address.slice(0, 16)}…</p>}
        </div>
      )}
    </div>
  );
}
