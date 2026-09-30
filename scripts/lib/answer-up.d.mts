// Types of answer-up.mjs, for the e2e tests that drive it.
import type { Page } from '@playwright/test';
import type {
  Meeting,
  MeetQuestion,
  OrientationOptions,
  PartJoint,
  UpChoices,
  UpQuestion,
} from '../../src/lib';

/** The question as the page keeps it in `state.question`. */
export type AskedQuestion = (UpQuestion | MeetQuestion) & { name: string; serial: number };

/**
 * What an up question is answered with (another base named, or the options to confirm), or a
 * meet question (#93): the joints or the meeting, or nothing for what is shown.
 */
export type Picked =
  | OrientationOptions
  | { baseFile: number | null }
  | { swap: true }
  | { joints?: PartJoint[]; meeting?: Meeting | null };

export type PickUp = (question: AskedQuestion) => Picked;

export declare const asDetected: PickUp;

export declare function fromChoices(choices: Partial<UpChoices>, otherwise?: PickUp): PickUp;

export declare function convertAnswering(
  page: Page,
  pick: PickUp,
  timeoutMs: number,
): Promise<void>;
