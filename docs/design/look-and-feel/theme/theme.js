// The theme switch of the server-rendered pages (spec 07 U1 and U5, #212; design note
// look-and-feel.md, sections 2.2 and 9): light, dark, or the system's setting, kept in this
// browser's localStorage under `mt-theme` and never sent. Loaded in the head of every page before
// the stylesheets, so the page paints in the chosen theme at once; when the page is parsed it
// shows the switch (`[data-theme-switch]`, hidden without this script) and wires its
// `[data-theme-choice]` buttons. The client's pages outside the table have the same rule in
// web/src/ui/theme.ts; its test runs this file against it.

(() => {
  const KEY = 'mt-theme';
  const root = document.documentElement;

  const read = () => {
    try {
      const stored = window.localStorage.getItem(KEY);
      return stored === 'light' || stored === 'dark' ? stored : 'system';
    } catch {
      return 'system';
    }
  };

  const store = (choice) => {
    try {
      if (choice === 'system') window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, choice);
    } catch {
      // A browser that keeps no storage still switches this page.
    }
  };

  // No attribute is the system's setting: tokens.css then lets color-scheme pick.
  const apply = (choice) => {
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
  };

  const show = (choice) => {
    for (const button of document.querySelectorAll('[data-theme-choice]')) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice));
    }
  };

  apply(read());

  document.addEventListener('DOMContentLoaded', () => {
    for (const group of document.querySelectorAll('[data-theme-switch]')) {
      group.removeAttribute('hidden');
    }
    for (const button of document.querySelectorAll('[data-theme-choice]')) {
      button.addEventListener('click', () => {
        const choice = button.dataset.themeChoice;
        store(choice);
        apply(choice);
        show(choice);
      });
    }
    show(read());
  });
})();
