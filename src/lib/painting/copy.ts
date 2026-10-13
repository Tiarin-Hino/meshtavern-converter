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
  /** What each tool does, a sentence or two for a panel to show beside it (#128). */
  toolHints: {
    flat: 'Paints the colour evenly wherever it touches.',
    fill: 'Fills the surface you tap, up to a fold or a crease. Tolerance lets it go further.',
    eraser: 'Takes the paint away again, back to the bare mini.',
    wash: 'Thin colour that runs into creases and recesses, tints flat areas faintly and leaves raised edges almost bare. Use it to shade.',
    ink: 'Stains everything it covers, darkest in the creases. Stronger than a wash, softer than the brush.',
    dry: 'Catches only the raised edges and crests. More pressure reaches further down from the edge. Use it to highlight.',
    airbrush:
      'A soft spray that builds up with every pass. Spraying from above reaches only surfaces that face up: a zenithal highlight in one pass.',
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
