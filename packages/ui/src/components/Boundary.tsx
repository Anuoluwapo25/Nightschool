/**
 * The lamp and the moon: what stayed on the learner's machine, and what the
 * chain saw. The one picture every lesson ends on.
 */

export type BoundaryRow = readonly [label: string, value: string];

export function Boundary({
  title,
  lamp,
  moon,
  footnote,
}: {
  title: string;
  lamp: readonly BoundaryRow[];
  moon: readonly BoundaryRow[];
  footnote?: string;
}) {
  return (
    <section className="boundary" aria-label={title}>
      <p className="boundary-title">{title}</p>
      <div className="boundary-panes">
        <div className="pane lamp">
          <p className="pane-head">
            <LampIcon /> Under your lamp
          </p>
          <dl>
            {lamp.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="pane-gap" aria-hidden>
          <span className="pulse" />
        </div>
        <div className="pane moon">
          <p className="pane-head">
            <MoonIcon /> In the moonlight
          </p>
          <dl>
            {moon.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      {footnote && <p className="boundary-foot">{footnote}</p>}
    </section>
  );
}

export const LampIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="icon-lamp">
    <path d="M5 2h6l2 6H3z" />
    <path d="M8 8v5M5 14h6" />
  </svg>
);

export const MoonIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="icon-moon">
    <path d="M11 2a6 6 0 1 0 3 10A6.5 6.5 0 0 1 11 2z" />
  </svg>
);
