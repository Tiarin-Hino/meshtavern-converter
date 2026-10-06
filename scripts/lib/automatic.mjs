// How often a mini is right without a correction (issue #101): per corpus mini, whether the up
// direction, the scale, the base size and the character-or-prop guess (#99) the converter came
// to by itself are the expected ones
// of scripts/corpus-index.json, and the rate over the corpus. Pure: scripts/corpus.mjs feeds it
// the figures of a run whose questions were answered as detected, and writes what it returns.
// Keys are corpus keys (`<kind>/<name>`), which are committed in the index and never a product
// name (CONTRIBUTING.md), so the report can be quoted in a journal entry or a PR.

/** A corpus of print files is in millimetres; an index entry says `units` when a file is not. */
export const EXPECTED_UNITS = 'mm';
/** A corpus mini is a character; an index entry says `kind` when it is a prop (#99). */
export const EXPECTED_KIND = 'character';
/** The checks, in the order they are reported: what a person can correct at the table's import step. */
export const CHECKS = ['up', 'scale', 'size', 'guess'];
/** A free turn (`rotation` in the index) is met when every component is this close, either sign. */
export const ROTATION_TOLERANCE = 1e-3;

const sameRotation = (a, b) =>
  [1, -1].some((sign) =>
    a.every((value, i) => Math.abs(value - sign * b[i]) <= ROTATION_TOLERANCE),
  );

/**
 * One mini against its index entry. Each check is `{ ok, got, expected }`, or null when the
 * index has nothing to check it against (the scale always has: `EXPECTED_UNITS`):
 * - `up`: the up direction in the file, or the free turn when the entry has a `rotation`;
 * - `scale`: the units guessed from the height;
 * - `size`: the creature size suggested from the base (or the default without one);
 * - `guess`: character or prop as guessed (#99), with the share the base-top rule measured in
 *   `share`; null for a run from before the guess. Named apart from a row's `kind`, its folder.
 * `right` is true when all four hold, false when one fails or the mini did not convert, and
 * null when up or size has no expected value: such a mini is not counted.
 *
 * @param mini What results.json keeps of a mini (`up`, `orientation`, `sizing`, or `error`).
 * @param entry Its entry in the index, or undefined.
 */
export function checkMini(mini, entry = {}) {
  const counted = entry.up !== undefined && entry.size !== undefined;
  if (mini.error) {
    return {
      up: null,
      scale: null,
      size: null,
      guess: null,
      right: counted ? false : null,
      converted: false,
    };
  }
  const check = (got, expected) =>
    expected === undefined ? null : { ok: got === expected, got, expected };
  const up =
    entry.rotation === undefined
      ? check(mini.up, entry.up)
      : {
          ok: sameRotation(mini.orientation.rotation, entry.rotation),
          got: mini.up,
          expected: 'a free turn',
        };
  const scale = check(mini.sizing.units, entry.units ?? EXPECTED_UNITS);
  const size = check(mini.sizing.size, entry.size);
  const guess = mini.guess
    ? { ...check(mini.guess.kind, entry.kind ?? EXPECTED_KIND), share: mini.guess.topShare }
    : null;
  const right =
    up === null || size === null ? null : up.ok && scale.ok && size.ok && (guess?.ok ?? true);
  return { up, scale, size, guess, right, converted: true };
}

/** Which checks of a counted mini failed: `converted` for one that did not become a mini. */
export const failedChecks = (row) =>
  row.converted ? CHECKS.filter((name) => row[name] && !row[name].ok) : ['converted'];

/**
 * The rate over a run: every mini checked (`minis`, by key, with its `kind`), how many were
 * counted and right, each check on its own over the minis that have an expected value for it,
 * and the same per kind with the keys that fail.
 *
 * @param minis results.json's `minis`.
 * @param index The parsed corpus index.
 */
export function automaticRate(minis, index) {
  const rows = Object.fromEntries(
    Object.entries(minis).map(([key, mini]) => [
      key,
      { kind: mini.kind, ...checkMini(mini, index[key]) },
    ]),
  );
  const all = Object.entries(rows);
  const tally = (list) => ({
    right: list.filter(([, row]) => row.right).length,
    counted: list.length,
  });
  const counted = all.filter(([, row]) => row.right !== null);
  const checks = Object.fromEntries(
    CHECKS.map((name) => {
      const checked = all.filter(([, row]) => row[name] !== null);
      return [
        name,
        { right: checked.filter(([, row]) => row[name].ok).length, counted: checked.length },
      ];
    }),
  );
  const byKind = {};
  for (const kind of [...new Set(counted.map(([, row]) => row.kind))].sort()) {
    const ofKind = counted.filter(([, row]) => row.kind === kind);
    byKind[kind] = {
      ...tally(ofKind),
      failed: ofKind
        .filter(([, row]) => !row.right)
        .map(([key, row]) => ({ key, checks: failedChecks(row) })),
    };
  }
  return {
    ...tally(counted),
    checks,
    byKind,
    notCounted: all.filter(([, row]) => row.right === null).map(([key]) => key),
    minis: rows,
  };
}

const share = ({ right, counted }) =>
  counted === 0
    ? 'none counted'
    : `${right} of ${counted} (${Math.round((right / counted) * 100)} %)`;
const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows].join('\n');
const CHECK_WORDS = {
  up: 'up',
  scale: 'scale',
  size: 'base size',
  guess: 'kind',
  converted: 'not converted',
};
/** What the guess came to, with the share it measured: "character (0.62)". */
const guessed = (check) =>
  check.share == null ? check.got : `${check.got} (${check.share.toFixed(2)})`;

/** What changed since `previous` (an earlier `automaticRate`, or null), as Markdown lines. */
function sinceLast(rate, previous) {
  if (!previous) return ['No earlier rate to compare with.'];
  const moved = Object.entries(rate.minis)
    .filter(([key, row]) => key in previous.minis && previous.minis[key].right !== row.right)
    .map(
      ([key, row]) =>
        `${key} (${
          row.right
            ? 'now right'
            : `now fails: ${failedChecks(row)
                .map((name) => CHECK_WORDS[name])
                .join(', ')}`
        })`,
    );
  return [
    `Last run: ${share(previous)}.${moved.length > 0 ? ` Changed: ${moved.join('; ')}.` : ' No mini changed.'}`,
  ];
}

/**
 * The "Right without correction" section of results.md: the rate, each check, the kinds with
 * the minis that fail, what moved since the last run, and every mini's three checks.
 *
 * @param notes What the index says about a mini (`note`), by key: printed next to a failure.
 */
export function automaticReport(rate, previous = null, notes = {}) {
  const cell = (check) =>
    check === null
      ? '?'
      : check.ok
        ? `${check.got} ✓`
        : `**${check.got}**, expected ${check.expected}`;
  const cellGuess = (check) =>
    check === null
      ? '?'
      : check.ok
        ? `${guessed(check)} ✓`
        : `**${guessed(check)}**, expected ${check.expected}`;
  const verdict = (row) => (row.right === null ? 'not counted' : row.right ? 'yes' : '**no**');
  const failures = Object.entries(rate.byKind).flatMap(([kind, of]) =>
    of.failed.length === 0
      ? []
      : [
          `- **${kind}** (${of.failed.length} of ${of.counted}):`,
          ...of.failed.map(({ key, checks }) => {
            const row = rate.minis[key];
            const what = checks
              .map((name) =>
                name === 'converted'
                  ? CHECK_WORDS[name]
                  : `${CHECK_WORDS[name]} ${name === 'guess' ? guessed(row[name]) : row[name].got}, expected ${row[name].expected}`,
              )
              .join('; ');
            return `  - ${key}: ${what}${notes[key] ? ` (${notes[key]})` : ''}`;
          }),
        ],
  );
  return [
    `**${share(rate)} minis are right without a correction**: up direction, scale, base size and character or prop all as the index expects, with every question confirmed as detected. Up: ${share(rate.checks.up)}. Scale (the units guessed): ${share(rate.checks.scale)}. Base size (the creature size suggested): ${share(rate.checks.size)}. Character or prop (the guess from the base): ${share(rate.checks.guess)}.`,
    ...sinceLast(rate, previous),
    table(
      ['Kind', 'Right', 'Fail'],
      Object.entries(rate.byKind).map(
        ([kind, of]) => `| ${kind} | ${share(of)} | ${of.failed.length} |`,
      ),
    ),
    failures.length === 0
      ? 'No counted mini fails.'
      : ['Minis that fail, by kind:', ...failures].join('\n'),
    `Not counted (no expected up direction or size in the index): ${rate.notCounted.join(', ') || 'none'}.`,
    table(
      ['Mini', 'Kind', 'Up', 'Scale', 'Base size', 'Character or prop', 'Right'],
      Object.entries(rate.minis).map(([key, row]) =>
        row.converted
          ? `| ${key} | ${row.kind} | ${cell(row.up)} | ${cell(row.scale)} | ${cell(row.size)} | ${cellGuess(row.guess)} | ${verdict(row)} |`
          : `| ${key} | ${row.kind} | not converted | | | | ${verdict(row)} |`,
      ),
    ),
  ].join('\n\n');
}
