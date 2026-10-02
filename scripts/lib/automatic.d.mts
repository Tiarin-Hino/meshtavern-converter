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
  /** Null: not counted, the index has no expected up direction or size. */
  right: boolean | null;
  converted: boolean;
}

export interface Tally {
  right: number;
  counted: number;
}

export interface AutomaticRate extends Tally {
  checks: Record<'up' | 'scale' | 'size', Tally>;
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
}

export interface IndexEntry {
  up?: string;
  rotation?: number[];
  units?: string;
  size?: string;
  note?: string;
}

export const EXPECTED_UNITS: string;
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
