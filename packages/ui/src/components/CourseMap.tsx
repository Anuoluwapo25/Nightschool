/**
 * The course as a constellation: one star per lesson, joined in order. A star
 * glows once you have solved its lesson and burns steady once you have claimed
 * it on chain. Lessons still to come are drawn faint.
 */

import { COMING, LESSONS } from '../lessons.js';

export type Progress = 'new' | 'solved' | 'claimed';

// Positions on a 1000×340 canvas: an even zigzag read left to right, spaced
// for however many stars there are. Stars on a high point carry their labels
// above, low ones below, so no label sits on a line.
const STAR_COUNT = LESSONS.length + COMING.length;
const POINTS: readonly [number, number][] = Array.from({ length: STAR_COUNT }, (_, i) => [
  Math.round(70 + (860 * i) / Math.max(1, STAR_COUNT - 1)),
  i % 2 === 0 ? 230 : 110,
]);

const isPeak = (i: number): boolean => POINTS[i]![1] < 170;

export function CourseMap({
  progress,
  onOpen,
}: {
  progress: (slug: string) => Progress;
  onOpen: (lesson: number) => void;
}) {
  const stars = [
    ...LESSONS.map((lesson) => ({ ...lesson, future: false })),
    ...COMING.map((c, i) => ({
      ...c,
      slug: `coming-${i}`,
      number: LESSONS.length + i + 1,
      future: true,
    })),
  ];

  return (
    <figure className="map">
      <svg viewBox="0 0 1000 340" role="img" aria-label="Course map">
        <defs>
          <radialGradient id="glow">
            <stop offset="0%" stopColor="var(--lamp)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--lamp)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {stars.slice(1).map((star, i) => {
          const [x1, y1] = POINTS[i]!;
          const [x2, y2] = POINTS[i + 1]!;
          return (
            <line
              key={star.slug}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={`map-line ${star.future ? 'future' : ''}`}
            />
          );
        })}
        {stars.map((star, i) => {
          const [x, y] = POINTS[i]!;
          const state = star.future ? 'future' : progress(star.slug);
          return (
            <g
              key={star.slug}
              className={`star ${state}`}
              transform={`translate(${x} ${y})`}
              onClick={star.future ? undefined : () => onOpen(star.number)}
              onKeyDown={
                star.future
                  ? undefined
                  : (e) => {
                      if (e.key === 'Enter' || e.key === ' ') onOpen(star.number);
                    }
              }
              tabIndex={star.future ? -1 : 0}
              role={star.future ? undefined : 'link'}
              aria-label={star.future ? undefined : `Lesson ${star.number}: ${star.title}`}
            >
              {state !== 'future' && state !== 'new' && <circle r="42" fill="url(#glow)" />}
              <circle r="15" className="star-hit" />
              <path className="star-shape" d={starPath(state === 'future' ? 5 : 9)} />
              <text className="star-num" y={isPeak(i) ? 28 : -20} textAnchor="middle">
                {String(star.number).padStart(2, '0')}
              </text>
              <text className="star-title" y={isPeak(i) ? -40 : 38} textAnchor="middle">
                {star.title}
              </text>
              <text className="star-concept" y={isPeak(i) ? -20 : 58} textAnchor="middle">
                {star.future ? 'coming soon' : star.concept}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** A four-pointed star of outer radius r. */
const starPath = (r: number): string => {
  const k = r * 0.28;
  return `M0 ${-r} L${k} ${-k} L${r} 0 L${k} ${k} L0 ${r} L${-k} ${k} L${-r} 0 L${-k} ${-k} Z`;
};
