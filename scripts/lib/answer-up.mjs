// Answers the page's questions (issue #92, design note docs/design/up-before-reduce.md §7; issue
// #93, docs/design/marks-where-parts-meet.md §7) for runs nobody watches: the corpus run, the feedback mode
// with --up detected or index, the memory measurement. The page is driven through its hooks
// (window.__mt), as a person would press Confirm.

/** Confirms every proposal: the files stand as the converter detected them. */
export const asDetected = () => ({});

/**
 * Answers every question with the choices a conversion ended with (`stats.choices`, as a
 * feedback record keeps them, #93): the base named, each file's axis or turn, the parts' joints
 * and the marks where the figure meets its base. The same files in the same order convert to
 * the same mini. `otherwise` answers what the choices do not say.
 */
export function fromChoices(choices, otherwise = asDetected) {
  return (question) => {
    const baseFile = choices.pairing?.baseFile;
    if (question.kind === 'meet')
      return question.about === 'parts'
        ? { joints: choices.parts?.joints ?? [] }
        : { meeting: choices.placement?.marks ?? null };
    if (baseFile !== undefined && baseFile !== question.roles.baseFile) return { baseFile };
    const options = question.role === 'base' ? choices.baseOrientation : choices.orientation;
    return options && Object.keys(options).length > 0 ? options : otherwise(question);
  };
}

/**
 * Waits until the conversion started on `page` asks or ends, answers each up question with
 * `confirmUp(pick(question))` and each meet question (#93) with what `pick(question)` returns
 * (`{ joints }`, `{ meeting }`, or `{}` for what is shown), and returns when the conversion ended
 * in a mini or an error.
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
      // Where the parts meet (#93): the joints or the meeting `pick` names, else what is shown.
      const answer = pick(question) ?? {};
      if (answer.joints !== undefined || answer.meeting !== undefined)
        await page.evaluate((changes) => window.__mt.answerMeet(changes), answer);
      await page.evaluate(() => window.__mt.confirmMeet());
      continue;
    }
    const options = pick(question) ?? {};
    // Another base named (#93): the questions start again with it.
    if (options.baseFile !== undefined) {
      await page.evaluate((file) => window.__mt.chooseBase(file), options.baseFile);
      continue;
    }
    await page.evaluate((chosen) => window.__mt.confirmUp(chosen), options);
  }
}
