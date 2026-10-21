import { createDialog } from './dialog';

/**
 * The confirm dialog (#167, design note `docs/design/painter-on-the-page.md` §8.3): a question with
 * a yes and a no, on the application's dialog (`dialog.ts`, `role="alertdialog"`). Three uses: the
 * offer of an unsaved painting, a reconversion over unsaved steps, Open over unsaved steps. Escape,
 * a click on the scrim and the no button answer no; focus goes back to what opened it.
 */
export interface Confirm {
  /** Asks `text`, the buttons worded `yes` and `no`; resolves true for yes. One question at a time. */
  ask(text: string, yes: string, no: string): Promise<boolean>;
  /** Answers the question on screen, as its button does (the test hook). */
  answer(yes: boolean): void;
  /** The question on screen; null when none is. */
  readonly text: string | null;
}

export function createConfirm(
  scrim: HTMLElement,
  onChange: (text: string | null) => void,
): Confirm {
  const text = scrim.querySelector<HTMLElement>('#confirm-text')!;
  const yesButton = scrim.querySelector<HTMLButtonElement>('#confirm-yes')!;
  const noButton = scrim.querySelector<HTMLButtonElement>('#confirm-no')!;
  let pending: ((yes: boolean) => void) | null = null;
  let answered = false;
  let asked: string | null = null;

  const settle = (yes: boolean): void => {
    const resolve = pending;
    pending = null;
    asked = null;
    onChange(null);
    resolve?.(yes);
  };
  const dialog = createDialog(scrim, () => {
    // Closed by Escape, the scrim or a button: no, unless yes was pressed.
    const yes = answered;
    answered = false;
    settle(yes);
  });
  const answer = (yes: boolean): void => {
    if (!pending) return;
    answered = yes;
    dialog.close();
  };
  yesButton.addEventListener('click', () => answer(true));
  noButton.addEventListener('click', () => answer(false));

  return {
    ask(question, yes, no) {
      if (pending) settle(false);
      text.textContent = question;
      yesButton.textContent = yes;
      noButton.textContent = no;
      asked = question;
      onChange(question);
      return new Promise((resolve) => {
        pending = resolve;
        dialog.open();
      });
    },
    answer,
    get text() {
      return asked;
    },
  };
}
