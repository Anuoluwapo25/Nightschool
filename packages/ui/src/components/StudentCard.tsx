/**
 * The learner's student card. The pattern is drawn from their enrolment
 * fingerprint — the only thing about them the chain ever holds — so two
 * learners' cards never look alike, and the card shows exactly what is public.
 */

import { useState } from 'react';
import { pureCircuits, toHex } from '@nightschool/contract';
import type { AvailableWallet, WalletSession } from '../wallet.js';

export function Fingerprint({ bytes, size = 72 }: { bytes: Uint8Array; size?: number }) {
  // A 5×5 grid mirrored left to right, coloured by the low bits of each byte.
  const cells: { x: number; y: number; tone: number }[] = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const byte = bytes[y * 3 + x] ?? 0;
      if (byte % 3 === 0) continue;
      const tone = byte % 2;
      cells.push({ x, y, tone });
      if (x < 2) cells.push({ x: 4 - x, y, tone });
    }
  }
  return (
    <svg viewBox="0 0 5 5" width={size} height={size} className="fingerprint" aria-hidden>
      {cells.map((c) => (
        <rect
          key={`${c.x}-${c.y}`}
          x={c.x}
          y={c.y}
          width="1"
          height="1"
          className={`fp-${c.tone}`}
        />
      ))}
    </svg>
  );
}

export function StudentCard({
  secret,
  enrolled,
  solved,
  total,
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
  solved: number;
  total: number;
  session: WalletSession | undefined;
  wallets: AvailableWallet[];
  proofServer: string;
  busy: boolean;
  onCreate: () => void;
  onForget: () => void;
  onConnect: (wallet: AvailableWallet) => void;
  onProofServer: (url: string) => void;
  onEnroll: (invite: string) => void;
}) {
  const [invite, setInvite] = useState('');
  const fingerprint = secret ? pureCircuits.learnerCommitment(secret) : undefined;

  const backup = () => {
    if (!secret) return;
    const url = URL.createObjectURL(new Blob([`${toHex(secret)}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nightschool-student-secret.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card-wrap" aria-label="Your student card">
      <div className={`student ${enrolled ? 'enrolled' : ''}`}>
        <div className="student-top">
          <span className="student-school">Nightschool · Student card</span>
          <span className="student-status">
            {enrolled ? 'Enrolled' : secret ? 'Not enrolled' : 'No card yet'}
          </span>
        </div>
        {fingerprint ? (
          <div className="student-body">
            <Fingerprint bytes={fingerprint} />
            <div>
              <span className="student-label">Public fingerprint</span>
              <code className="student-fp">{toHex(fingerprint).slice(0, 24)}…</code>
              <span className="student-label">
                {enrolled
                  ? `${solved} of ${total} lessons claimed`
                  : 'Your secret stays in this browser'}
              </span>
            </div>
          </div>
        ) : (
          <div className="student-empty">
            <p>
              Your card is a secret made in this browser. Only its fingerprint ever reaches the
              chain, and nothing you claim can be traced back to it.
            </p>
            <button className="btn lamp" onClick={onCreate}>
              Make my card
            </button>
          </div>
        )}
      </div>

      {secret && (
        <div className="student-actions">
          <div className="small muted">
            <button className="link" onClick={backup}>
              Back up secret
            </button>{' '}
            ·{' '}
            <button className="link" onClick={onForget}>
              Forget card
            </button>
          </div>

          {!enrolled && (
            <ol className="todo">
              <li className={session ? 'done' : ''}>
                <span>Connect a Midnight wallet (Lace, on Preprod)</span>
                {session ? (
                  <code className="small">{session.shieldedAddress.slice(0, 22)}…</code>
                ) : wallets.length === 0 ? (
                  <span className="small muted">No wallet found in this browser.</span>
                ) : (
                  <span className="row-gap">
                    {wallets.map((w) => (
                      <button
                        key={w.id}
                        className="btn small"
                        disabled={!w.supported}
                        onClick={() => onConnect(w)}
                      >
                        {w.api.name}
                      </button>
                    ))}
                  </span>
                )}
              </li>
              <li>
                <span>Proof server on your machine</span>
                <input
                  className="mono small-input"
                  value={proofServer}
                  onChange={(e) => onProofServer(e.target.value)}
                  aria-label="Proof server URL"
                />
              </li>
              <li>
                <span>Enrol with the invite your organizer gave you</span>
                <span className="row-gap">
                  <input
                    className="mono small-input"
                    placeholder="invite code"
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                    spellCheck={false}
                  />
                  <button
                    className="btn small lamp"
                    disabled={!session || busy || !/^[0-9a-fA-F]{64}$/.test(invite.trim())}
                    onClick={() => onEnroll(invite)}
                  >
                    Enrol
                  </button>
                </span>
              </li>
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
