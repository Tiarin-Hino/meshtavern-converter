/**
 * The bar's More menu on a phone (#144, design note look-and-feel.md §4.1): the application's
 * `.menu` markup, opened under its button. The arrows, Home and End move between the items,
 * Escape and Tab close it (Escape gives focus back to the button), a click elsewhere closes it.
 * The application's own menu module is private to its repo, so the page has this one.
 *
 * The theme's items press the bar's switch, which keeps the choice (theme.js): one place stores
 * it. They are `menuitemradio`s, checked by the theme the page is in.
 */
export interface Menu {
  open(): void;
  close(focusButton?: boolean): void;
  readonly isOpen: boolean;
}

/** The gap between the button and the menu under it, in CSS pixels. */
const MENU_GAP_PX = 4;

export function createMenu(button: HTMLElement, menu: HTMLElement): Menu {
  const items = (): HTMLElement[] =>
    [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
      (item) => item.offsetParent !== null,
    );

  const showTheme = (): void => {
    const current = document.documentElement.getAttribute('data-theme') ?? 'system';
    for (const item of menu.querySelectorAll<HTMLElement>('[data-theme-item]'))
      item.setAttribute('aria-checked', String(item.dataset.themeItem === current));
  };

  const place = (): void => {
    const box = button.getBoundingClientRect();
    menu.style.top = `${box.bottom + MENU_GAP_PX}px`;
    menu.style.right = `${Math.max(0, window.innerWidth - box.right)}px`;
  };

  const close = (focusButton = false): void => {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focusButton) button.focus();
  };

  const open = (): void => {
    showTheme();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    items()[0]?.focus();
  };

  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  menu.addEventListener('keydown', (event) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number): void => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(list.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') close();
  });
  menu.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[role^="menuitem"]');
    if (!item) return;
    const choice = item.dataset.themeItem;
    if (choice) {
      document
        .querySelector<HTMLElement>(`[data-theme-switch] [data-theme-choice="${choice}"]`)
        ?.click();
      showTheme();
    }
    close(choice !== undefined);
  });
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Node;
    if (!menu.contains(target) && !button.contains(target)) close();
  });
  window.addEventListener('resize', () => close());

  return {
    open,
    close,
    get isOpen() {
      return !menu.hidden;
    },
  };
}
