import type { GroupOrigin } from '../pipeline/brush';

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
    mask: 'Mask',
    unmask: 'Unmask',
    'mask-fill': 'Mask fill',
    'unmask-fill': 'Unmask fill',
    group: 'Group brush',
    'group-fill': 'Group fill',
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
    mask: 'Paints a mask, like liquid mask on a real mini: no tool changes the paint under it until you take it away.',
    unmask: 'Takes the mask away where it goes, so the tools reach the surface there again.',
    'mask-fill':
      'Masks the surface you tap, up to a fold, a crease or the mask already there. Tolerance lets it go further.',
    'unmask-fill':
      'Takes the mask away from the surface you tap, up to a fold, a crease or the edge of the mask.',
    group:
      'Marks the triangles it covers as part of the chosen group. Hide a group to paint what lies behind it.',
    'group-fill':
      'Marks the connected surface you tap, up to the mask, a hidden or pulled-apart group, or the edge of the group you tap in. Mask a wrist, then tap the hand.',
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
  /** The mask's whole changes and its tint (#138): for a panel's buttons. */
  mask: {
    clear: 'Clear mask',
    invert: 'Invert mask',
    show: 'Show mask',
    base: 'Mask the base',
    figure: 'Mask the figure',
  },
  /**
   * The groups (#139): the panel's row, the names `describeGroup` builds from, and what hiding is.
   * `part`, `shell` and `hand` are followed by a number.
   */
  groups: {
    label: 'Groups',
    body: 'The body',
    part: 'Part',
    base: 'The base',
    shell: 'Shell',
    hand: 'Group',
    of: 'of',
    hide: 'Hide',
    show: 'Show',
    showAll: 'Show all',
    tint: 'Show groups',
    newGroup: 'New group',
    into: 'Add to',
    fill: 'Fill the group',
    mask: 'Mask the group',
    unmask: 'Unmask the group',
    hint: 'A hidden group is not drawn and takes no paint, so you can paint what lies behind it. Hiding is not a step: Show brings it back, not Undo.',
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

/**
 * A group's name for a panel (#139, design note `docs/design/paint-groups.md` §7), from how it was
 * made (`PaintGroups.made`): "The body", "Part 2" (the file's number in the order given, or its
 * name in `fileNames`, by `PartResult.file`), "The base", "Shell 2 of the body" (the body itself
 * is its shell 1; shells split from the same group are numbered in the order they were made) or
 * "Group 5" for one made by hand (its index + 1). `copy` replaces the words, as the view's own.
 */
export function describeGroup(
  made: readonly GroupOrigin[],
  index: number,
  fileNames: readonly (string | undefined)[] = [],
  copy: PaintCopy['groups'] = PAINT_COPY.groups,
): string {
  const origin = made[index];
  if (!origin) throw new RangeError(`There is no group ${index}`);
  switch (origin.by) {
    case 'body':
      return copy.body;
    case 'part':
      return fileNames[origin.file] ?? `${copy.part} ${origin.file + 1}`;
    case 'base':
      return copy.base;
    case 'hand':
      return `${copy.hand} ${index + 1}`;
    case 'shell': {
      let number = 1;
      for (let k = 0; k <= index; k++) {
        const other = made[k]!;
        if (other.by === 'shell' && other.of === origin.of) number++;
      }
      const of = describeGroup(made, origin.of, fileNames, copy);
      // "the body", "the base": a name that starts with the copy's own article reads lower-case after "of".
      const after =
        of === copy.body || of === copy.base ? of.charAt(0).toLowerCase() + of.slice(1) : of;
      return `${copy.shell} ${number} ${copy.of} ${after}`;
    }
  }
}
