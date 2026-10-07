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
// The view (#119): mounted into the consumer's elements, it draws every question and sends every
// answer. Its stylesheet is ./questions.css (package export `meshtavern-converter/questions.css`),
// imported once by the consumer: an import of a stylesheet here would stop Node and Playwright,
// which cannot load one, from importing the words above.
export {
  mountQuestions,
  type QuestionsOptions,
  type QuestionsView,
  type QuestionsState,
  type AskedQuestion,
  type AskedMeet,
  type MeetUi,
  type TurnAxis,
  type ConversionToAsk,
  PAIR_COLOURS,
  TAP_MAX_PX,
  TAP_MAX_MS,
  BRUSH_STEP_PX,
  BRUSH_RADIUS_MM,
  FOCUS_HOLD_MS,
  PANEL_WIDTH_PX,
} from './questions/mount';
export { UPLOAD_BYTES_PER_FRAME } from './questions/mesh-chunks';
