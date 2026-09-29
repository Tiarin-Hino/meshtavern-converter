// Types of answer-up.mjs, for the e2e tests that drive it.
import type { Page } from '@playwright/test';
import type { OrientationOptions, UpQuestion } from '../../src/lib';

/** The question as the page keeps it in `state.question`. */
export type AskedQuestion = Omit<UpQuestion, 'mesh'> & { name: string; serial: number };

export type PickUp = (question: AskedQuestion) => OrientationOptions;

export declare const asDetected: PickUp;

export declare function convertAnswering(
  page: Page,
  pick: PickUp,
  timeoutMs: number,
): Promise<void>;
