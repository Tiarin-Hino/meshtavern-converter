// Types of automatic.mjs, for its unit test.

/** One check of one mini: what the converter came to, and what the index expects. */
export interface Check {
  ok: boolean;
  got: string;
  expected: string;
}

export interface MiniChecks {
  kind: string;
  up: Check | null;
  scale: Check | null;
  size: Check | null;
  /** Character or prop (#99), with the share the base-top rule measured; null for a run before the guess. */
  guess: (Check & { share: number | null }) | null;
  /** Null: not counted, the index has no expected up direction or size. */
  right: boolean | null;
  converted: boolean;
}

export interface Tally {
  right: number;
  counted: number;
}

export interface AutomaticRate extends Tally {
  checks: Record<'up' | 'scale' | 'size' | 'guess', Tally>;
  byKind: Record<string, Tally & { failed: { key: string; checks: string[] }[] }>;
  notCounted: string[];
  minis: Record<string, MiniChecks>;
}

/** What results.json keeps of a mini, as far as the checks read it. */
export interface MiniFigures {
  kind: string;
  error?: string;
  up?: string;
  orientation?: { rotation: number[] };
  sizing?: { units: string; size: string };
  /** The character-or-prop guess (#99); left out by runs before it. */
  guess?: { kind: string; reason: string; topShare: number | null };
}

export interface IndexEntry {
  up?: string;
  rotation?: number[];
  units?: string;
  size?: string;
  /** `prop` for a mini that is its own base; left out, a character (#99). */
  kind?: string;
  note?: string;
}

export const EXPECTED_UNITS: string;
export const EXPECTED_KIND: string;
export const CHECKS: readonly string[];
export const ROTATION_TOLERANCE: number;
export function checkMini(mini: MiniFigures, entry?: IndexEntry): Omit<MiniChecks, 'kind'>;
export function failedChecks(row: Omit<MiniChecks, 'kind'>): string[];
export function automaticRate(
  minis: Record<string, MiniFigures>,
  index: Record<string, IndexEntry>,
): AutomaticRate;
export function automaticReport(
  rate: AutomaticRate,
  previous?: AutomaticRate | null,
  notes?: Record<string, string | undefined>,
): string;
