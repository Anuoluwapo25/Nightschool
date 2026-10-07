/**
 * Hands-on widgets, one per lesson. Each lets the learner poke at the idea
 * before the task asks them to use it — and none of them computes a task's
 * answer for them.
 */

import { useEffect, useMemo, useState } from 'react';
import { networkConfig } from '@nightschool/api/config';
import { challengeIdOf, pureCircuits, randomBytes32, toHex } from '@nightschool/contract';
import { CONSERVE_ADDRESS, type Widget } from '../lessons.js';

export function LessonWidget({ widget }: { widget: Widget }) {
  switch (widget) {
    case 'query':
      return <QueryRunner />;
    case 'pad':
      return <PadBytes />;
    case 'bruteforce':
      return <BruteForce />;
    case 'nullifiers':
      return <Nullifiers />;
  }
}

// ---------------------------------------------------------------------------
// 01 — a live GraphQL box against the Preprod indexer
// ---------------------------------------------------------------------------

const STARTER_QUERY = `{
  contractAction(address: "${CONSERVE_ADDRESS}") {
    __typename
    transaction {
      ???
    }
  }
}`;

function QueryRunner() {
  const [query, setQuery] = useState(STARTER_QUERY);
  const [output, setOutput] = useState<string>();
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const response = await fetch(networkConfig('preprod').indexerUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      setOutput(JSON.stringify(await response.json(), null, 2));
    } catch (cause) {
      setOutput(`Could not reach the indexer: ${cause instanceof Error ? cause.message : cause}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="query">
      <textarea
        className="query-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
        rows={9}
        aria-label="GraphQL query"
      />
      <div className="query-bar">
        <span className="query-endpoint">POST indexer.preprod.midnight.network/api/v3/graphql</span>
        <button className="btn moon" onClick={() => void run()} disabled={running}>
          {running ? 'Asking…' : 'Run query'}
        </button>
      </div>
      {output && (
        <pre className="query-output" aria-live="polite">
          {output}
        </pre>
      )}
      <p className="widget-note">
        Errors are useful here: GraphQL tells you exactly which field it did not recognise.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 02 — what pad(32, "…") produces
// ---------------------------------------------------------------------------

function PadBytes() {
  const [text, setText] = useState('midnight');
  const bytes = useMemo(() => new TextEncoder().encode(text), [text]);
  const overflow = bytes.length > 32;
  const cells = Array.from({ length: 32 }, (_, i) => bytes[i]);

  return (
    <div className="pad">
      <label className="pad-input">
        <span className="mono">pad(32, "</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="Text to pad"
        />
        <span className="mono">")</span>
      </label>
      <div
        className="bytes"
        role="img"
        aria-label={`${Math.min(bytes.length, 32)} text bytes then zeros`}
      >
        {cells.map((byte, i) => (
          <span key={i} className={`byte ${byte === undefined ? 'zero' : 'used'}`}>
            <span className="byte-hex">
              {byte === undefined ? '00' : byte.toString(16).padStart(2, '0')}
            </span>
            <span className="byte-char">
              {byte === undefined
                ? '·'
                : byte >= 32 && byte < 127
                  ? String.fromCharCode(byte)
                  : '…'}
            </span>
          </span>
        ))}
      </div>
      <p className="widget-note">
        {overflow
          ? `That is ${bytes.length} bytes — pad(32, …) would refuse it at compile time.`
          : `${bytes.length} byte${bytes.length === 1 ? '' : 's'} of text, ${32 - bytes.length} zeros. Non-English letters take more than one byte each — try “é” or “月”.`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 03 — why a bare hash of a small value hides nothing
// ---------------------------------------------------------------------------

const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));

const scoreBytes = (score: number, salt?: Uint8Array): Uint8Array<ArrayBuffer> => {
  const value = new TextEncoder().encode(String(score));
  if (!salt) return value;
  const out = new Uint8Array(value.length + salt.length);
  out.set(value);
  out.set(salt, value.length);
  return out;
};

type Attempt = { found?: number; tried: number; ms: number };

function BruteForce() {
  const [secret] = useState(() => Math.floor(Math.random() * 101));
  const [salt] = useState(() => randomBytes32());
  const [salted, setSalted] = useState(false);
  const [published, setPublished] = useState<string>();
  const [attempt, setAttempt] = useState<Attempt>();

  useEffect(() => {
    setAttempt(undefined);
    setPublished(undefined);
    void sha256(scoreBytes(secret, salted ? salt : undefined)).then(setPublished);
  }, [secret, salt, salted]);

  const crack = async () => {
    const start = performance.now();
    for (let guess = 0; guess <= 100; guess += 1) {
      // The attacker does not have the salt, so they can only hash the bare guess.
      if ((await sha256(scoreBytes(guess))) === published) {
        setAttempt({ found: guess, tried: guess + 1, ms: performance.now() - start });
        return;
      }
    }
    setAttempt({ tried: 101, ms: performance.now() - start });
  };

  return (
    <div className="brute">
      <p className="brute-story">
        A student’s exam score, 0 to 100, was published on chain as a fingerprint. Can you find the
        score?
      </p>
      <div className="segmented" role="group" aria-label="How the score was published">
        <button className={!salted ? 'on' : ''} onClick={() => setSalted(false)}>
          hash(score)
        </button>
        <button className={salted ? 'on' : ''} onClick={() => setSalted(true)}>
          commit(score, salt)
        </button>
      </div>
      <div className="brute-row">
        <span className="tag moon">on chain</span>
        <code className="hex">{published ?? '…'}</code>
      </div>
      <button className="btn" onClick={() => void crack()} disabled={!published}>
        Try all 101 scores
      </button>
      {attempt &&
        (attempt.found !== undefined ? (
          <p className="verdict bad">
            Found it: the score is <strong>{attempt.found}</strong>. {attempt.tried} guesses,{' '}
            {attempt.ms.toFixed(1)} ms. That hash hid nothing.
          </p>
        ) : (
          <p className="verdict good">
            All 101 guesses missed. Without the salt — which never left the student’s machine — the
            fingerprint is useless to an attacker. The score was {secret}.
          </p>
        ))}
      <p className="widget-note">
        Illustrated with SHA-256; Compact’s persistentCommit works the same way.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 04 — nullifiers for two people and two challenges, with the real circuit
// ---------------------------------------------------------------------------

const PEOPLE = ['Alice', 'Bob'] as const;
const CHALLENGES = ['first-hash', 'nullifiers'] as const;

function Nullifiers() {
  // Random secrets, so this table never shows a task’s answer.
  const [secrets] = useState(() => ({ Alice: randomBytes32(), Bob: randomBytes32() }));
  const [spent, setSpent] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<{ text: string; ok: boolean }[]>([]);

  const nullifier = (person: (typeof PEOPLE)[number], challenge: string) =>
    toHex(pureCircuits.claimNullifier(secrets[person], challengeIdOf(challenge)));

  const claim = (person: (typeof PEOPLE)[number], challenge: string) => {
    const n = nullifier(person, challenge);
    const ok = !spent.has(n);
    if (ok) setSpent(new Set(spent).add(n));
    setLog((entries) =>
      [
        {
          ok,
          text: ok
            ? `${person} claims ${challenge} → nullifier ${n.slice(0, 10)}… published`
            : `${person} claims ${challenge} again → refused, ${n.slice(0, 10)}… already spent`,
        },
        ...entries,
      ].slice(0, 5),
    );
  };

  return (
    <div className="nulls">
      <div className="nulls-grid" role="table">
        <span role="columnheader" />
        {CHALLENGES.map((c) => (
          <span key={c} role="columnheader" className="mono small">
            {c}
          </span>
        ))}
        {PEOPLE.map((person) => (
          <div key={person} role="row" className="nulls-row">
            <span role="rowheader" className="nulls-person">
              {person}
              <span className="small muted">secret: random</span>
            </span>
            {CHALLENGES.map((c) => {
              const n = nullifier(person, c);
              return (
                <button
                  key={c}
                  role="cell"
                  className={`nulls-cell ${spent.has(n) ? 'spent' : ''}`}
                  onClick={() => claim(person, c)}
                  title="Claim"
                >
                  <code>{n.slice(0, 12)}…</code>
                  <span className="small">{spent.has(n) ? 'spent' : 'claim'}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <ol className="nulls-log" aria-live="polite">
        {log.map((entry, i) => (
          <li key={i} className={entry.ok ? 'good' : 'bad'}>
            {entry.text}
          </li>
        ))}
      </ol>
      <p className="widget-note">
        Every cell is different, so the chain cannot tell that two cells belong to the same person.
        Click one twice.
      </p>
    </div>
  );
}
