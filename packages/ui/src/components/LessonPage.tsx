import { useEffect, useState } from 'react';
import {
  type Ledger,
  answerDigestOf,
  answerMatches,
  challengeIdOf,
  hasClaimed,
  toHex,
} from '@nightschool/contract';
import { LESSONS, type Lesson } from '../lessons.js';
import { Boundary, type BoundaryRow } from './Boundary.js';
import { LessonWidget } from './widgets.js';

const short = (hex: string, n = 10): string => `${hex.slice(0, n)}…${hex.slice(-4)}`;

export type ClaimReceipt = {
  readonly slug: string;
  readonly txId: string;
  readonly nullifier: string;
};

export function LessonPage({
  lesson,
  state,
  secret,
  enrolled,
  walletReady,
  busy,
  receipt,
  onSolved,
  onClaim,
  onOpen,
  onCard,
}: {
  lesson: Lesson;
  state: Ledger | undefined;
  secret: Uint8Array | undefined;
  enrolled: boolean;
  walletReady: boolean;
  busy: boolean;
  receipt: ClaimReceipt | undefined;
  onSolved: (slug: string) => void;
  onClaim: (lesson: Lesson, answer: string) => void;
  onOpen: (lesson: number) => void;
  onCard: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [verdict, setVerdict] = useState<'right' | 'wrong'>();
  const [digest, setDigest] = useState<string>();
  const id = challengeIdOf(lesson.slug);
  const claimed = state !== undefined && secret !== undefined && hasClaimed(state, secret, id);
  const next = LESSONS.find((l) => l.number === lesson.number + 1);
  const previous = LESSONS.find((l) => l.number === lesson.number - 1);

  useEffect(() => {
    setAnswer('');
    setVerdict(undefined);
    window.scrollTo({ top: 0 });
  }, [lesson.slug]);

  const check = async () => {
    if (!state) return;
    const ok = await answerMatches(state, id, answer);
    setDigest(toHex(await answerDigestOf(answer)));
    setVerdict(ok ? 'right' : 'wrong');
    if (ok) onSolved(lesson.slug);
  };

  const lamp: BoundaryRow[] = [
    ['Your answer', `${answer.trim().slice(0, 8)}… (never sent)`],
    ['Its fingerprint, computed here', digest ? short(digest) : '…'],
  ];
  const moon: BoundaryRow[] = [
    ['Challenge', lesson.slug],
    ['Answer commitment on chain', state ? short(toHex(state.challenges.lookup(id))) : '…'],
    ['Requests this check made', 'none'],
  ];

  return (
    <article className="lesson-page">
      <nav className="crumbs">
        <button className="link quiet" onClick={() => onOpen(0)}>
          ← Course map
        </button>
        <span>
          Lesson {lesson.number} of {LESSONS.length}
        </span>
      </nav>

      <header className="lesson-header">
        <p className="kicker">
          Lesson {String(lesson.number).padStart(2, '0')} ·{' '}
          <span className="mono">{lesson.concept}</span>
        </p>
        <h1>{lesson.title}</h1>
        <p className="hook">{lesson.hook}</p>
      </header>

      <div className="reading">
        {lesson.paragraphs.map((p) => (
          <div className="para" key={p.text.slice(0, 32)}>
            <p>{renderInline(p.text)}</p>
            {p.aside && <aside className="aside">{renderInline(p.aside)}</aside>}
          </div>
        ))}
      </div>

      <section className="try">
        <p className="try-label">Try it · {lesson.widgetTitle}</p>
        <LessonWidget widget={lesson.widget} />
      </section>

      <section className="task-block">
        <p className="task-label">Your task</p>
        <p className="task-text">{renderInline(lesson.task)}</p>
        <details className="hint">
          <summary>A place to start</summary>
          <pre className="code" data-lang={lesson.hint.language}>
            <code>{lesson.hint.code}</code>
          </pre>
        </details>

        <label className="answer-field">
          <span className="sr-only">Your answer</span>
          <input
            className="mono"
            placeholder="Paste your 64-character answer"
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              setVerdict(undefined);
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            className="btn lamp"
            disabled={!state || answer.trim() === ''}
            onClick={() => void check()}
          >
            Check under the lamp
          </button>
        </label>

        {verdict === 'wrong' && (
          <p className="verdict bad">
            Not this one. Your guess was checked here and went nowhere — nobody saw it.
          </p>
        )}

        {verdict === 'right' && (
          <>
            <Boundary
              title="Correct — and here is what that check revealed"
              lamp={lamp}
              moon={moon}
              footnote="Your browser hashed your answer and compared it with the commitment the instructor published. The chain was only read, never written."
            />
            <div className="takeaway">
              <p className="task-label">You can now say</p>
              <p>{lesson.takeaway}</p>
            </div>
          </>
        )}

        {(verdict === 'right' || claimed) && (
          <div className="claim">
            {claimed && receipt?.slug === lesson.slug ? (
              <Boundary
                title="Claimed on Midnight"
                lamp={[
                  ['Your answer', 'never left this browser'],
                  ['Which student you are', 'hidden among every enrolled student'],
                ]}
                moon={[
                  ['Challenge', lesson.slug],
                  ['Nullifier', short(receipt.nullifier)],
                  ['Reward', 'a shielded coin — amount and owner hidden'],
                  ['Transaction', short(receipt.txId, 14)],
                ]}
              />
            ) : claimed ? (
              <p className="verdict good">You have claimed this lesson on chain.</p>
            ) : enrolled && walletReady ? (
              <button className="btn moon" disabled={busy} onClick={() => onClaim(lesson, answer)}>
                Prove it on Midnight and claim {String(state?.rewards.lookup(id) ?? '')} Night
                Credits
              </button>
            ) : (
              <p className="muted">
                Want it on your record?{' '}
                <button className="link" onClick={onCard}>
                  Get your student card
                </button>{' '}
                and enrol, then prove this answer on chain — still without revealing it.
              </p>
            )}
          </div>
        )}
      </section>

      <nav className="pager">
        {previous ? (
          <button className="pager-link" onClick={() => onOpen(previous.number)}>
            <span className="small muted">Previous</span>
            {previous.title}
          </button>
        ) : (
          <span />
        )}
        {next ? (
          <button className="pager-link next" onClick={() => onOpen(next.number)}>
            <span className="small muted">Next</span>
            {next.title}
          </button>
        ) : (
          <button className="pager-link next" onClick={() => onOpen(0)}>
            <span className="small muted">That’s the course so far</span>
            Back to the map
          </button>
        )}
      </nav>
    </article>
  );
}

/** Renders `code spans` in lesson prose. */
function renderInline(text: string) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : <span key={i}>{part}</span>,
    );
}
