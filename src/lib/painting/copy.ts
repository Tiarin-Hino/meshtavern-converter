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
    lift: 'Lift',
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
    lift: 'Takes away the stroke you start on, wherever it is still on top, and shows the paint beneath it. Start again on the same spot to lift the layer under that.',
    wash: 'Thin colour that runs into creases and recesses, tints flat areas faintly and leaves raised edges almost bare. Use it to shade.',
    ink: 'Stains everything it covers, darkest in the creases. Stronger than a wash, softer than the brush.',
    dry: 'Catches the highest points under the brush where the stroke starts, and anything as high along it. More pressure reaches further down from them, and is needed for very low detail. Use it to highlight.',
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
  /** The pipette (#135): its button, the two modes, and what it does. */
  pick: {
    button: 'Pick a colour',
    shown: 'As shown',
    painted: 'As painted',
    hint: 'Tap the mini to take a colour from it. As shown takes it as you see it, light and shade included; as painted takes the paint itself.',
    nothing: 'Nothing to pick there: off the mini, or no paint on it.',
  },
  /** Why a lift stroke took nothing away (#137): for a panel to show after it. */
  lift: {
    nothingPainted: 'Nothing painted here to lift: the paint the mini came with stays.',
    tooLongAgo: 'Painted too long ago to lift: only the most recent steps can be taken away.',
  },
  /** The colours used (#136): a row of swatches from `recentColours`, and each swatch's name before its colour. */
  recent: { label: 'Colours used', swatch: 'Paint with' },
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
