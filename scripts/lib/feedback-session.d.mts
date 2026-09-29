// Types of feedback-session.mjs, for the e2e test that drives it.
import type { Browser, Page } from '@playwright/test';

export declare const FEEDBACK_TIMEOUT_MS: number;

export type Verdict = 'right' | 'placed' | 'skipped' | 'next' | 'end';

export declare function installFeedback(page: Page): Promise<() => Promise<Verdict>>;

export declare function recordPath(outDir: string, key: string): string;

export declare function reviewPair(
  page: Page,
  pair: { key: string; figure: string; base: string },
  session: {
    index: number;
    total: number;
    commit: string;
    outDir: string;
    browser: Browser;
    nextVerdict: () => Promise<Verdict>;
  },
): Promise<'right' | 'placed' | 'skipped' | 'refused' | 'end'>;
