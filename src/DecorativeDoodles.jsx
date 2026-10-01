import React from 'react';

const drawings = {
  plate: (
    <>
      <circle className="doodle-fill-paper" cx="60" cy="60" r="40" />
      <circle className="doodle-line" cx="60" cy="60" r="31" />
      <circle className="doodle-line" cx="60" cy="60" r="23" />
      <path className="doodle-line" d="M16 34v23m-7-23v12m14-12v12m-7 0v26m86-38c-7 8-9 18-7 29l7 8V34Z" />
      <path className="doodle-line doodle-coral" d="M43 76c8 6 25 8 35 0" />
      <circle className="doodle-fill-yellow" cx="82" cy="37" r="5" />
    </>
  ),
  people: (
    <>
      <circle className="doodle-fill-yellow" cx="60" cy="31" r="12" />
      <circle className="doodle-fill-coral" cx="31" cy="43" r="9" />
      <circle className="doodle-fill-mint" cx="89" cy="43" r="9" />
      <path className="doodle-fill-paper doodle-line" d="M38 85c1-18 9-27 22-27s21 9 22 27H38Z" />
      <path className="doodle-fill-paper doodle-line" d="M8 89c1-15 7-23 18-23 8 0 13 5 16 13-3 4-5 8-5 14H8Z" />
      <path className="doodle-fill-paper doodle-line" d="M84 79c3-8 8-13 16-13 11 0 17 8 18 23H88c0-4-1-7-4-10Z" />
      <path className="doodle-coral doodle-line" d="M51 48c3 3 6 3 9 0m8 0c3 3 6 3 9 0" />
    </>
  ),
  coin: (
    <>
      <circle className="doodle-fill-yellow doodle-line" cx="60" cy="60" r="39" />
      <circle className="doodle-line" cx="60" cy="60" r="30" />
      <path className="doodle-line" d="M69 43c-3-3-7-5-12-4-7 1-10 8-5 12 4 4 16 3 16 11 0 6-7 10-14 9-5 0-9-2-12-6m18-31v42" />
      <path className="doodle-coral doodle-line" d="m89 23 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" />
    </>
  ),
  spark: (
    <>
      <path className="doodle-fill-coral" d="M60 8 69 43 103 30 78 55 112 70 75 72 82 110 60 80 37 109 45 73 8 78 40 57 12 34 48 44Z" />
      <circle className="doodle-fill-yellow" cx="91" cy="21" r="6" />
      <circle className="doodle-fill-mint" cx="23" cy="97" r="5" />
    </>
  ),
  wave: (
    <>
      <path className="doodle-line doodle-wave-line" d="M10 69c13-24 20 22 33 0s21 22 34 0 21 22 33 0" />
      <circle className="doodle-fill-coral" cx="14" cy="38" r="5" />
      <circle className="doodle-fill-yellow" cx="100" cy="93" r="7" />
      <path className="doodle-line doodle-green" d="m51 22 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z" />
    </>
  ),
};

const compositions = {
  hero: ['plate', 'wave', 'spark'],
  history: ['people', 'spark', 'wave'],
  friends: ['people', 'spark', 'wave'],
  bill: ['plate', 'coin', 'spark'],
  sharing: ['people', 'coin', 'wave'],
  summary: ['coin', 'spark', 'wave'],
  drawer: ['spark', 'wave', 'coin'],
  shared: ['plate', 'spark', 'wave'],
  admin: ['people', 'plate', 'spark'],
};

export function Doodle({ kind = 'spark', className = '' }) {
  return (
    <span className={`hk-doodle hk-doodle--${kind} ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 120 120" focusable="false">{drawings[kind] || drawings.spark}</svg>
    </span>
  );
}

export default function DoodleField({ variant = 'hero', className = '' }) {
  const [primary, secondary, tertiary] = compositions[variant] || compositions.hero;

  return (
    <div className={`hk-doodle-field hk-doodle-field--${variant} ${className}`.trim()} aria-hidden="true">
      <span className="hk-doodle-paper hk-doodle-paper--one" />
      <span className="hk-doodle-paper hk-doodle-paper--two" />
      <Doodle kind={primary} className="hk-doodle-primary" />
      <Doodle kind={secondary} className="hk-doodle-secondary" />
      <Doodle kind={tertiary} className="hk-doodle-tertiary" />
    </div>
  );
}
