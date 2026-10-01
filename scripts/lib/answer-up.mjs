// Answers the page's questions (issue #92, design note docs/design/up-before-reduce.md §7; issue
// #93, docs/design/patches-where-parts-meet.md §8) for runs nobody watches: the corpus run, the feedback mode
// with --up detected or index, the memory measurement. The page is driven through its hooks
// (window.__mt), as a person would press Confirm.

/** Confirms every proposal: the files stand as the converter detected them. */
export const asDetected = () => ({});

/**
 * Answers every question with the choices a conversion ended with (`stats.choices`, as a
 * feedback record keeps them, #93): the base named or the swap taken, each file's axis or turn,
 * the parts' joints and the marks where the figure meets its base. The same files in the same
 * order convert to the same mini. `otherwise` answers what the choices do not say. One call per
 * conversion: a recorded swap is replayed once, at the first up question.
 */
export function fromChoices(choices, otherwise = asDetected) {
  let swapped = false;
  return (question) => {
    const baseFile = choices.pairing?.baseFile;
    if (question.kind === 'meet') {
      if (question.about !== 'parts') {
        const { marks, liftMm, turnDeg } = choices.placement ?? {};
        // The automatic placement nudged at the final view (#93): no marks, a lift and a turn.
        const nudge =
          !marks && (liftMm || turnDeg) ? { liftMm: liftMm ?? 0, turnDeg: turnDeg ?? 0 } : null;
        return { marks: marks ?? null, ...(nudge && { nudge }) };
      }
      // Under other roles than the record's the joints do not fit: the parts are confirmed as
      // shown, the base question names the recorded base, and the parts are asked again under it.
      const joints = choices.parts?.joints ?? [];
      return baseFile !== undefined && baseFile !== question.roles.baseFile
        ? {}
        : { marks: joints.length > 0 ? joints : null };
    }
    if (baseFile !== undefined && baseFile !== question.roles.baseFile) return { baseFile };
    // A swap of a guessed pair is recorded as `swap`, not as the base it named.
    if (choices.pairing?.swap && !swapped) {
      swapped = true;
      return { swap: true };
    }
    const options = question.role === 'base' ? choices.baseOrientation : choices.orientation;
    return options && Object.keys(options).length > 0 ? options : otherwise(question);
  };
}

/**
 * Waits until the conversion started on `page` asks or ends, answers each up question with
 * `confirmUp(pick(question))` and each meet question (#93) with what `pick(question)` returns:
 * `{ marks }` (a meeting, the joints, or null for the proposal) is set at the pairs stop unless
 * the question has them already, `{ nudge }` is applied once to the automatic placement at the
 * final view, `{}` confirms what is shown; both stops are confirmed. Returns when the conversion
 * ended in a mini or an error.
 * Throws when it does not end within `timeoutMs`. A page opened with `?ask=off` asks nothing:
 * then this only waits for the end.
 *
 * @param pick From the question (`state.question`) to the options to confirm with.
 */
export async function convertAnswering(page, pick, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new Error(`the conversion did not end within ${timeoutMs} ms`);
    const handle = await page.waitForFunction(
      () => {
        const { question, stats, error, busy, page: shown } = window.__mt.state;
        if (question && shown === 'asking') return 'question';
        return (stats || error) && !busy ? 'ended' : false;
      },
      null,
      { timeout },
    );
    if ((await handle.jsonValue()) === 'ended') return;
    const question = await page.evaluate(() => window.__mt.state.question);
    if (question.kind === 'meet') {
      // Where the parts meet (#93): the marks `pick` names at the pairs stop, then both stops.
      const answer = pick(question) ?? {};
      if (
        question.stage === 'pairs' &&
        answer.marks !== undefined &&
        JSON.stringify(answer.marks) !== JSON.stringify(question.marks)
      ) {
        await page.evaluate((marks) => window.__mt.answerMeet({ do: 'set', marks }), answer.marks);
        continue;
      }
      if (
        question.stage === 'fitted' &&
        answer.nudge &&
        question.placement?.method === 'detected'
      ) {
        await page.evaluate(
          (change) => window.__mt.answerMeet({ do: 'nudge', ...change }),
          answer.nudge,
        );
        continue;
      }
      await page.evaluate(() => window.__mt.confirmMeet());
      continue;
    }
    const options = pick(question) ?? {};
    // Another base named (#93), or the two swapped: the questions start again with it.
    if (options.baseFile !== undefined) {
      await page.evaluate((file) => window.__mt.chooseBase(file), options.baseFile);
      continue;
    }
    if (options.swap) {
      await page.evaluate(() => window.__mt.swapAtQuestion());
      continue;
    }
    await page.evaluate((chosen) => window.__mt.confirmUp(chosen), options);
  }
}
