// Types of feedback-session.mjs, for the e2e test that drives it.
import type { Browser, Page } from '@playwright/test';
import type { Rotation, UpAxis } from '../../src/lib';
import type { PickUp } from './answer-up.mjs';

export declare const FEEDBACK_TIMEOUT_MS: number;

export type Verdict = 'right' | 'placed' | 'skipped' | 'next' | 'end';

export declare function installFeedback(page: Page): Promise<() => Promise<Verdict>>;

export declare function recordPath(outDir: string, key: string): string;

/** A pair to review; `up`, `rotation` and `baseUp` answer its questions with `up: 'index'` (#92). */
export interface FeedbackPair {
  key: string;
  figure: string;
  base: string;
  up?: UpAxis;
  rotation?: Rotation;
  baseUp?: UpAxis;
}

export declare function pickFromPair(pair: FeedbackPair): PickUp;

export declare function reviewPair(
  page: Page,
  pair: FeedbackPair,
  session: {
    index: number;
    total: number;
    commit: string;
    outDir: string;
    browser: Browser;
    nextVerdict: () => Promise<Verdict>;
    /** How the questions after the orient step are answered (#92). Default `ask`: on the page. */
    up?: 'ask' | 'detected' | 'index';
  },
): Promise<'right' | 'placed' | 'skipped' | 'refused' | 'end'>;
