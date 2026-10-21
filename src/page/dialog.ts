/**
 * The application's dialog, as the page opens it (#144, design note look-and-feel.md §4.6): a
 * `.scrim` with a `.dialog` inside, shown over the page. Escape, a click on the scrim or a button
 * with `data-dialog-close` closes it and gives focus back to what opened it; Tab stays inside.
 * The application's own dialog module is private to its repo, so the page has this one.
 */
export interface Dialog {
  open(opener?: HTMLElement | null): void;
  close(): void;
  readonly isOpen: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex="0"]';

/** `onClose` hears every close, however it came (#167: the confirm dialog's no). */
export function createDialog(scrim: HTMLElement, onClose?: () => void): Dialog {
  const box = scrim.querySelector<HTMLElement>('.dialog')!;
  let opener: HTMLElement | null = null;

  const close = (): void => {
    if (scrim.hidden) return;
    scrim.hidden = true;
    opener?.focus();
    opener = null;
    onClose?.();
  };

  scrim.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target === scrim || target.closest('[data-dialog-close]')) close();
  });
  scrim.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return {
    open(from = document.activeElement as HTMLElement | null) {
      opener = from;
      scrim.hidden = false;
      box.focus();
    },
    close,
    get isOpen() {
      return !scrim.hidden;
    },
  };
}
