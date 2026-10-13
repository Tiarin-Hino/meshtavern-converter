/**
 * The painting view's words (issue #127, design note `docs/design/painting-engine.md` §10.2). The
 * view itself shows only `cannotPaint`, as the message of its refusal; the rest is offered so a
 * consumer's panel and the page's `?dev` tool say the same words, as `QUESTION_COPY` does for the
 * questions. Every string is a proposal the PM may change.
 */
export const PAINT_COPY = {
  cannotPaint: 'This mini has no detail texture, so it cannot be painted.',
  tools: {
    flat: 'Brush',
    fill: 'Fill',
    eraser: 'Eraser',
    wash: 'Wash',
    ink: 'Ink',
    dry: 'Dry brush',
    airbrush: 'Airbrush',
  },
  sliders: {
    sizeMm: 'Size',
    hardness: 'Hardness',
    opacity: 'Opacity',
    strength: 'Strength',
    flow: 'Flow',
    pressure: 'Pressure',
    tolerance: 'Tolerance',
    direction: 'From',
  },
  regions: { base: 'The base', figure: 'The figure' },
  undo: 'Undo',
  redo: 'Redo',
  navigate: 'Turn the mini',
  hint: 'Paint with one finger or the left button; two fingers or the right button turn the mini.',
} as const;

/** The words a consumer may replace: `copy` in `mountPainting`'s options, field by field. */
export type PaintCopy = {
  -readonly [K in keyof typeof PAINT_COPY]: (typeof PAINT_COPY)[K] extends string
    ? string
    : { -readonly [L in keyof (typeof PAINT_COPY)[K]]: string };
};
