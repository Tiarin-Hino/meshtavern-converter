// Answers the page's question after the orient step (issue #92, design note
// docs/design/up-before-reduce.md §7) for runs nobody watches: the corpus run, the feedback mode
// with --up detected or index, the memory measurement. The page is driven through its hooks
// (window.__mt), as a person would press Confirm.

/** Confirms every proposal: the files stand as the converter detected them. */
export const asDetected = () => ({});

/**
 * Waits until the conversion started on `page` asks or ends, answers each question with
 * `confirmUp(pick(question))`, and returns when the conversion ended in a mini or an error.
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
    await page.evaluate((options) => window.__mt.confirmUp(options), pick(question));
  }
}
