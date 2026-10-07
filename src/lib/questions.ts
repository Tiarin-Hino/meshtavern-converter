/**
 * The questions a conversion asks, as a view other code mounts (issue #119, design note
 * `docs/design/questions-view.md`): which way is up, how a figure's parts go together, where it
 * meets its base. The fourth entry, beside index.ts (no three.js), three.ts and dev.ts.
 */
export {
  QUESTION_COPY,
  type QuestionCopy,
  type QuestionSentences,
  type QuestionWords,
  describeUp,
  describeAskedFile,
  describeAskPending,
  describePairWarning,
  describePairs,
  describePart,
  describeParts,
  describePlacement,
  partName,
  LIFT_STEP_MM,
  TURN_STEP_DEG,
} from './questions/copy';
