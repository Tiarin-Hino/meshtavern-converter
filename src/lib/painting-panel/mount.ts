import {
  isGroupTool,
  LOOK_PRESETS,
  presetOf,
  recentColours,
  type BrushSettings,
  type Look,
  type ToolId,
} from '../index';
import {
  BRUSH_MAX_MM,
  BRUSH_MIN_MM,
  describeGroup,
  PAINT_COPY,
  PICK_MODE,
  type PaintCopy,
  type PaintingState,
  type PaintingView,
  type PickMode,
} from '../painting';
import {
  DIRECTIONS,
  directionOf,
  panelSwatches,
  SIZE_STEP_MM,
  SLIDERS,
  sliderValue,
  UNIT_STEP,
} from './controls';
import { ICONS, type IconName } from './icons';

/**
 * The painter's panel (#166, design note `docs/design/painting-panel.md`): the sections of the
 * approved mockup (`docs/design/look-and-feel/app-painting.html`) and those of the tools that
 * landed after it, on MeshTavern's components, driving a `PaintingView`. It holds no state but
 * what is on screen: everything it shows is the view's state plus the consumer's palette.
 */

export interface PaintingPanelOptions {
  /** The engine's view the panel drives: mounted by the consumer with `mountPainting`. */
  view: PaintingView;
  /** The panel's sections go here, nothing else: a `.panel-body.flush` or any element the consumer frames. */
  controls: HTMLElement;
  /** Words to replace, field by field (§6); the same object the consumer gave the view. */
  copy?: Partial<PaintCopy>;
  /**
   * The consumer's colours for the palette, as sRGB hex: the page's last ones used on this device
   * (#167), the application's per account. Shown after the mini's own (§5.4). Left out: none.
   */
  palette?: readonly string[];
  /** The files' names, by the file index of a part's group (`describeGroup`); left out: "Part 2". */
  names?: readonly (string | undefined)[];
  /** What the pipette picks (#135): PICK_MODE, `'shown'`, unless the consumer says otherwise. */
  pickMode?: PickMode;
}

export interface PaintingPanel {
  /** What the panel adds to the view's state; replaced, not changed, on every change. */
  readonly state: PaintingPanelState;
  /** The consumer's colours changed (a step committed, another mini): the swatches are built again. */
  setPalette(colours: readonly string[]): void;
  setNames(names: readonly (string | undefined)[]): void;
  setPickMode(mode: PickMode): void;
  /** Unsubscribes from the view, releases the listeners and empties `controls`. The view is untouched. */
  dispose(): void;
}

export interface PaintingPanelState {
  /** The swatches as shown, in order: the mini's colours, then the consumer's not among them. */
  swatches: string[];
  pickMode: PickMode;
}

/** The elements a panel is mounted in: one panel per element. */
const mounted = new WeakSet<HTMLElement>();

/** The paint tools of the Tool section, in its order (§5.2). */
const PAINT_TOOLS = ['flat', 'fill', 'eraser', 'lift', 'wash', 'ink', 'dry', 'airbrush'] as const;
/** The mask's tools (§5.6) and the groups' (§5.7), each in its own section. */
const MASK_TOOLS = ['mask', 'unmask', 'mask-fill', 'unmask-fill'] as const;
const GROUP_TOOLS = ['group', 'group-fill'] as const;

/** Each tool's icon (§7). _(proposal: the lift's, the mask's and the groups')_ */
const TOOL_ICONS: Record<ToolId, IconName> = {
  flat: 'paintbrush',
  fill: 'paint-bucket',
  eraser: 'eraser',
  lift: 'layers',
  wash: 'droplet',
  ink: 'pencil',
  dry: 'brush',
  airbrush: 'spray-can',
  mask: 'shield',
  unmask: 'shield-off',
  'mask-fill': 'shield-plus',
  'unmask-fill': 'shield-minus',
  group: 'group',
  'group-fill': 'lasso-select',
};

/** The brush's sliders in the settings section's order; the direction comes after them. */
const BRUSH_SLIDERS = ['sizeMm', 'hardness', 'opacity', 'tolerance'] as const;
/** The look's sliders (§5.8). */
const LOOK_SLIDERS = ['occlusion', 'wash', 'edges'] as const;
/** The switches: view state, not steps (§5.6, §5.7). */
const SWITCHES = ['mask-show', 'groups-tint'] as const;

/**
 * Mounts the painter's panel into `options.controls` (§4.1): writes the template once, wires every
 * control to a method of the view, subscribes to it and shows its state at once.
 */
export function mountPaintingPanel(options: PaintingPanelOptions): PaintingPanel {
  return new Panel(options);
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ENTITIES[c]!);

/** The panel's markup (§5): every element the wiring and the tests reach has a `data-` attribute. */
function template(copy: PaintCopy): string {
  const t = escapeHtml;
  const tool = (id: ToolId): string =>
    `<button class="tool" type="button" data-tool="${id}" aria-label="${t(copy.tools[id])}" title="${t(copy.tools[id])}" aria-pressed="false">${ICONS[TOOL_ICONS[id]]}</button>`;
  const tools = (ids: readonly ToolId[], label: string): string =>
    `<div class="toolbar-group" role="group" aria-label="${t(label)}">${ids.map(tool).join('')}</div>`;
  const range = (min: number, max: number, step: number): string =>
    `<input type="range" min="${min}" max="${max}" step="${step}" />`;
  const slider = (key: (typeof BRUSH_SLIDERS)[number]): string =>
    `<label class="field" data-slider="${key}"><span><span data-label>${t(copy.sliders[key])}</span> <span class="muted" data-value></span></span>${
      key === 'sizeMm' ? range(BRUSH_MIN_MM, BRUSH_MAX_MM, SIZE_STEP_MM) : range(0, 1, UNIT_STEP)
    }</label>`;
  const directions = (Object.keys(DIRECTIONS) as (keyof typeof DIRECTIONS)[])
    .map(
      (name) =>
        `<button class="btn btn-sm" type="button" data-direction="${name}" aria-pressed="false">${t(copy.directions[name])}</button>`,
    )
    .join('');
  const button = (action: string, text: string): string =>
    `<button class="btn btn-sm" type="button" data-action="${action}">${t(text)}</button>`;
  const toggle = (action: (typeof SWITCHES)[number], text: string): string =>
    `<label class="switch"><input type="checkbox" data-action="${action}" /> ${t(text)}</label>`;
  const presets = LOOK_PRESETS.map(
    (preset) =>
      `<button class="chip" type="button" data-preset="${preset.id}" aria-pressed="false" style="--chip-color: ${t(preset.look.base)}"><span class="chip-dot"></span>${t(preset.label)}</button>`,
  ).join('');
  const lookSlider = (key: (typeof LOOK_SLIDERS)[number]): string =>
    `<label class="field" data-look="${key}"><span>${t(copy.look[key])} <span class="muted" data-value></span></span>${range(0, 1, UNIT_STEP)}</label>`;
  return `
<div class="panel-section" data-section="history">
<div class="actions"><div class="btn-group" role="group" aria-label="${t(copy.panel.history)}"><button class="btn btn-sm btn-icon" type="button" data-action="undo" aria-label="${t(copy.undo)}" title="${t(copy.undo)}">${ICONS['undo-2']}</button><button class="btn btn-sm btn-icon" type="button" data-action="redo" aria-label="${t(copy.redo)}" title="${t(copy.redo)}">${ICONS['redo-2']}</button></div><button class="btn btn-sm" type="button" data-action="navigate" aria-pressed="false">${ICONS.orbit}${t(copy.navigate)}</button></div>
<p class="hint">${t(copy.hint)}</p>
</div>
<div class="panel-section" data-section="tool">
<h3 class="panel-section-title">${t(copy.panel.tool)}</h3>
${tools(PAINT_TOOLS, copy.panel.tool)}
<p class="tool-hint" data-hint></p>
<p class="tool-hint" data-status role="status" aria-live="polite"></p>
</div>
<div class="panel-section" data-section="brush">
<h3 class="panel-section-title" data-brush-title></h3>
${BRUSH_SLIDERS.map(slider).join('')}
<div class="field" data-slider="direction"><span>${t(copy.sliders.direction)}</span><div class="segmented" role="group" aria-label="${t(copy.sliders.direction)}">${directions}</div></div>
</div>
<div class="panel-section" data-section="colour">
<h3 class="panel-section-title">${t(copy.panel.colour)}</h3>
<div class="field"><div class="field-row"><input type="color" data-colour aria-label="${t(copy.panel.colour)}" /><button class="tool" type="button" data-action="pick" aria-label="${t(copy.pick.button)}" title="${t(copy.pick.button)}" aria-pressed="false">${ICONS.pipette}</button></div><div class="swatches" role="group" aria-label="${t(copy.panel.colours)}" data-swatches></div></div>
</div>
<div class="panel-section" data-section="regions">
<h3 class="panel-section-title">${t(copy.panel.regions)}</h3>
<div class="actions" role="group" aria-label="${t(copy.panel.regions)}"><button class="btn btn-sm" type="button" data-region="base">${t(copy.regions.base)}</button><button class="btn btn-sm" type="button" data-region="figure">${t(copy.regions.figure)}</button></div>
<p class="hint">${t(copy.panel.regionsHint)}</p>
</div>
<div class="panel-section" data-section="mask">
<h3 class="panel-section-title">${t(copy.mask.label)}</h3>
${tools(MASK_TOOLS, copy.mask.label)}
<div class="actions">${button('mask-base', copy.mask.base)}${button('mask-figure', copy.mask.figure)}${button('mask-clear', copy.mask.clear)}${button('mask-invert', copy.mask.invert)}</div>
${toggle('mask-show', copy.mask.show)}
</div>
<div class="panel-section" data-section="groups">
<h3 class="panel-section-title">${t(copy.groups.label)}</h3>
${tools(GROUP_TOOLS, copy.groups.label)}
<ul class="rows" aria-label="${t(copy.groups.label)}" data-groups></ul>
<div class="actions">${button('groups-all', copy.groups.showAll)}${button('groups-apart', copy.groups.pullApart)}${button('groups-together', copy.groups.putTogether)}${button('group-fill', copy.groups.fill)}${button('group-mask', copy.groups.mask)}${button('group-unmask', copy.groups.unmask)}</div>
${toggle('groups-tint', copy.groups.tint)}
<p class="hint">${t(copy.groups.hint)}</p>
<p class="hint">${t(copy.groups.apartHint)}</p>
</div>
<div class="panel-section" data-section="look">
<h3 class="panel-section-title">${t(copy.look.label)}</h3>
<div class="field"><span>${t(copy.look.presets)}</span><div class="chips" role="group" aria-label="${t(copy.look.presets)}">${presets}</div></div>
<label class="check"><input type="checkbox" data-look="enabled" /> ${t(copy.look.enabled)}</label>
<label class="field"><span>${t(copy.look.base)}</span><span class="field-row"><input type="color" data-look="base" /><span class="muted" data-look-hex></span></span></label>
${LOOK_SLIDERS.map(lookSlider).join('')}
</div>`;
}

class Panel implements PaintingPanel {
  private readonly view: PaintingView;
  private readonly root: HTMLElement;
  private readonly copy: PaintCopy;
  private palette: string[];
  private names: (string | undefined)[];
  private pickMode: PickMode;
  private current: PaintingPanelState;
  private readonly unsubscribe: () => void;
  private readonly controller = new AbortController();
  /** The keys the swatches and the groups' rows were last built for: rebuilt only when one moves. */
  private swatchesFor = '';
  private groupsFor = '';
  /** The panel's own Pick press ended the pick: its null says nothing. */
  private cancelled = false;
  /** A notice for the status line (the pipette's, an action's error), shown until the view's next state. */
  private notice: { text: string; until: PaintingState } | null = null;

  constructor(options: PaintingPanelOptions) {
    const root = options.controls;
    if (mounted.has(root)) throw new Error('A painting panel is already mounted in this element');
    mounted.add(root);
    this.view = options.view;
    this.root = root;
    this.copy = { ...PAINT_COPY, ...options.copy } as PaintCopy;
    this.palette = [...(options.palette ?? [])];
    this.names = [...(options.names ?? [])];
    this.pickMode = options.pickMode ?? PICK_MODE;
    this.current = { swatches: [], pickMode: this.pickMode };
    root.classList.add('mt-painting-panel');
    root.innerHTML = template(this.copy);
    this.wire();
    this.unsubscribe = this.view.subscribe((state) => this.show(state));
    this.show(this.view.state);
  }

  get state(): PaintingPanelState {
    return this.current;
  }

  setPalette(colours: readonly string[]): void {
    this.palette = [...colours];
    this.show(this.view.state);
  }

  setNames(names: readonly (string | undefined)[]): void {
    this.names = [...names];
    this.show(this.view.state);
  }

  setPickMode(mode: PickMode): void {
    this.pickMode = mode;
    this.show(this.view.state);
  }

  dispose(): void {
    this.unsubscribe();
    this.controller.abort();
    this.root.replaceChildren();
    this.root.classList.remove('mt-painting-panel');
    mounted.delete(this.root);
  }

  private find<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }

  private all<T extends HTMLElement = HTMLElement>(selector: string): T[] {
    return [...this.root.querySelectorAll<T>(selector)];
  }

  /** The listeners: one per control, one on each list that is rebuilt. */
  private wire(): void {
    const { signal } = this.controller;
    const view = this.view;
    const on = <T extends HTMLElement>(
      selector: string,
      type: string,
      listener: (element: T) => unknown,
    ): void => {
      for (const element of this.all<T>(selector))
        element.addEventListener(
          type,
          () => void Promise.resolve(listener(element)).catch((error: unknown) => this.say(error)),
          { signal },
        );
    };
    const act = (action: string, listener: (element: HTMLInputElement) => unknown): void =>
      on(
        `[data-action="${action}"]`,
        (SWITCHES as readonly string[]).includes(action) ? 'change' : 'click',
        listener,
      );

    act('undo', () => view.undo());
    act('redo', () => view.redo());
    act('navigate', () => view.setNavigating(!view.state.navigating));
    on('[data-tool]', 'click', (button) => {
      const tool = button.dataset.tool as ToolId;
      const before = view.state.tool;
      view.setTool(tool);
      // Choosing a group tool shows the groups in their colours; leaving one hides them (#139).
      if (isGroupTool(before) !== isGroupTool(tool)) view.setGroupTint(isGroupTool(tool));
    });
    on<HTMLInputElement>('[data-slider] input', 'input', (input) => {
      const key = input.closest<HTMLElement>('[data-slider]')!.dataset.slider!;
      view.setBrush({ [key]: Number(input.value) });
    });
    on('[data-direction]', 'click', (button) =>
      view.setBrush({ direction: DIRECTIONS[button.dataset.direction as keyof typeof DIRECTIONS] }),
    );
    on<HTMLInputElement>('[data-colour]', 'input', (input) => view.setColour(input.value));
    act('pick', async () => {
      if (view.state.picking) {
        this.cancelled = true;
        view.cancelPick();
        return;
      }
      this.cancelled = false;
      const hex = await view.pickColour(this.pickMode);
      if (hex) view.setColour(hex);
      // A pick ended by this button, by closing or by another pick says nothing.
      else if (view.state.open && !view.state.picking && !this.cancelled)
        this.say(this.copy.pick.nothing);
    });
    this.find('[data-swatches]').addEventListener(
      'click',
      (event) => {
        const swatch = (event.target as HTMLElement).closest<HTMLElement>('[data-swatch]');
        if (swatch) view.setColour(swatch.dataset.swatch!);
      },
      { signal },
    );
    on('[data-region]', 'click', (button) =>
      view.fillRegion(button.dataset.region as 'base' | 'figure'),
    );
    act('mask-base', () => view.maskRegion('base'));
    act('mask-figure', () => view.maskRegion('figure'));
    act('mask-clear', () => view.clearMask());
    act('mask-invert', () => view.invertMask());
    act('mask-show', (box) => view.setMaskShown(box.checked));
    this.find('[data-groups]').addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement;
        const row = target.closest<HTMLElement>('[data-target]');
        if (row) {
          const k = row.dataset.target!;
          view.setGroupTarget(k === 'new' ? 'new' : Number(k));
          return;
        }
        const shown = target.closest<HTMLElement>('[data-shown]');
        if (shown) {
          const k = Number(shown.dataset.shown);
          view.setGroupShown(k, view.state.groups.hidden.includes(k));
          return;
        }
        const apart = target.closest<HTMLElement>('[data-apart]');
        if (apart) {
          const k = Number(apart.dataset.apart);
          const pressed = apart.getAttribute('aria-pressed') === 'true';
          // The rule's offset for this group alone; a group the rule leaves in place stays unpressed.
          apart.setAttribute('aria-pressed', String(view.pullApart(k, pressed ? null : undefined)));
        }
      },
      { signal },
    );
    const target = (): number => view.state.groups.target;
    act('groups-all', () => view.showAllGroups());
    act('groups-apart', () => view.pullAllApart());
    act('groups-together', () => view.putTogether());
    act('group-fill', () => view.fillGroup(target()));
    act('group-mask', () => view.maskGroup(target(), true));
    act('group-unmask', () => view.maskGroup(target(), false));
    act('groups-tint', (box) => view.setGroupTint(box.checked));
    // The look: the whole look each time, read back from the view's state (§5.8).
    const look = (changes: Partial<Look>): void => view.setLook({ ...view.state.look, ...changes });
    on('[data-preset]', 'click', (chip) => {
      const preset = LOOK_PRESETS.find((entry) => entry.id === chip.dataset.preset);
      if (preset) view.setLook({ ...preset.look });
    });
    on<HTMLInputElement>('[data-look="enabled"]', 'change', (box) =>
      look({ enabled: box.checked }),
    );
    on<HTMLInputElement>('[data-look="base"]', 'input', (input) => look({ base: input.value }));
    for (const key of LOOK_SLIDERS)
      on<HTMLInputElement>(`[data-look="${key}"] input`, 'input', (input) =>
        look({ [key]: Number(input.value) }),
      );
  }

  /** A notice on the status line until the view's next state: the pipette's, or an action's error. */
  private say(message: unknown): void {
    const text = message instanceof Error ? message.message : String(message);
    this.notice = { text, until: this.view.state };
    this.show(this.view.state);
  }

  /** Writes every control from the view's state (§5): a few attribute writes, the lists only when their key moves. */
  private show(state: PaintingState): void {
    const { open } = state;
    const copy = this.copy;
    if (this.notice && this.notice.until !== state) this.notice = null;
    for (const control of this.all<HTMLButtonElement | HTMLInputElement>('button, input'))
      control.disabled = !open;

    // History.
    this.find<HTMLButtonElement>('[data-action="undo"]').disabled = !open || state.steps === 0;
    this.find<HTMLButtonElement>('[data-action="redo"]').disabled = !open || state.undone === 0;
    this.find('[data-action="navigate"]').setAttribute('aria-pressed', String(state.navigating));

    // The tools, one pressed across the three groups, and the one hint line for all of them.
    for (const button of this.all('[data-tool]'))
      button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool));
    this.find('[data-hint]').textContent = copy.toolHints[state.tool];
    const refused =
      state.tool === 'lift' && state.lift && 'refused' in state.lift ? state.lift.refused : null;
    this.find('[data-status]').textContent = refused
      ? refused === 'too-long-ago'
        ? copy.lift.tooLongAgo
        : copy.lift.nothingPainted
      : (this.notice?.text ?? '');

    // The tool's settings, titled by the tool's name.
    const sliders = SLIDERS[state.tool];
    this.find('[data-section="brush"]').hidden = sliders.show.length === 0;
    this.find('[data-brush-title]').textContent = copy.tools[state.tool];
    for (const field of this.all('[data-slider]')) {
      const key = field.dataset.slider as keyof BrushSettings;
      field.hidden = !sliders.show.includes(key);
      if (key === 'direction') continue;
      const value = state.brush[key];
      const input = field.querySelector('input')!;
      if (input.value !== String(value)) input.value = String(value);
      field.querySelector('[data-value]')!.textContent = sliderValue(key, value, copy.panel);
      if (key === 'opacity')
        field.querySelector('[data-label]')!.textContent = copy.sliders[sliders.opacity];
    }
    const direction = directionOf(state.brush.direction);
    for (const button of this.all('[data-direction]'))
      button.setAttribute('aria-pressed', String(button.dataset.direction === direction));

    // Colour, the pipette and the swatches.
    const colour = this.find<HTMLInputElement>('[data-colour]');
    if (colour.value !== state.colour) colour.value = state.colour;
    this.find('[data-action="pick"]').setAttribute('aria-pressed', String(state.picking));
    this.showSwatches(state);

    // Regions and the mask.
    const has = (region: string): boolean =>
      open && state.regions.includes(region as 'base' | 'figure');
    for (const button of this.all<HTMLButtonElement>('[data-region]'))
      button.disabled = !has(button.dataset.region!);
    this.find<HTMLButtonElement>('[data-action="mask-base"]').disabled = !has('base');
    this.find<HTMLButtonElement>('[data-action="mask-figure"]').disabled = !has('figure');
    this.find<HTMLInputElement>('[data-action="mask-show"]').checked = state.maskShown;

    // The groups.
    const { list, apart, target } = state.groups;
    const none = target >= list.length;
    for (const action of ['group-fill', 'group-mask', 'group-unmask'])
      this.find<HTMLButtonElement>(`[data-action="${action}"]`).disabled = !open || none;
    this.find<HTMLButtonElement>('[data-action="groups-together"]').disabled =
      !open || apart.length === 0;
    this.find<HTMLInputElement>('[data-action="groups-tint"]').checked = state.groupTint;
    this.showGroups(state);

    // The look.
    const look = state.look;
    const preset = presetOf(look);
    for (const chip of this.all('[data-preset]'))
      chip.setAttribute('aria-pressed', String(chip.dataset.preset === preset));
    this.find<HTMLInputElement>('[data-look="enabled"]').checked = look.enabled;
    const base = this.find<HTMLInputElement>('[data-look="base"]');
    if (base.value !== look.base) base.value = look.base;
    this.find('[data-look-hex]').textContent = look.base;
    for (const key of LOOK_SLIDERS) {
      const field = this.find(`[data-look="${key}"]`);
      const input = field.querySelector('input')!;
      if (input.value !== String(look[key])) input.value = String(look[key]);
      field.querySelector('[data-value]')!.textContent = sliderValue(key, look[key], copy.panel);
    }
  }

  /** The swatches (§5.4): the mini's colours, then the consumer's; rebuilt when the history or the palette move. */
  private showSwatches(state: PaintingState): void {
    const key = state.open ? JSON.stringify([state.steps, state.undone, this.palette]) : '';
    if (key !== this.swatchesFor) {
      this.swatchesFor = key;
      const swatches = state.open
        ? panelSwatches(recentColours(this.view.history()), this.palette)
        : [];
      this.find('[data-swatches]').replaceChildren(
        ...swatches.map((hex) => {
          const swatch = document.createElement('button');
          swatch.type = 'button';
          swatch.className = 'swatch';
          swatch.dataset.swatch = hex;
          swatch.style.setProperty('--swatch', hex);
          swatch.setAttribute('aria-label', `${this.copy.recent.swatch} ${hex}`);
          swatch.title = hex;
          return swatch;
        }),
      );
      this.current = { swatches, pickMode: this.pickMode };
    } else if (this.current.pickMode !== this.pickMode)
      this.current = { ...this.current, pickMode: this.pickMode };
    const colour = state.colour.toLowerCase();
    for (const swatch of this.all<HTMLButtonElement>('[data-swatch]')) {
      swatch.setAttribute('aria-pressed', String(swatch.dataset.swatch === colour));
      swatch.disabled = !state.open;
    }
  }

  /**
   * The groups' rows (§5.7): a row a group, its name and triangles on the button that makes it the
   * target, Hide and, but for the body, Apart beside it; one more row for a new group. Rebuilt
   * when the groups move.
   */
  private showGroups(state: PaintingState): void {
    const { list, hidden, apart, target } = state.groups;
    const key = state.open ? JSON.stringify([list, hidden, apart, target, this.names]) : '';
    if (key === this.groupsFor) return;
    this.groupsFor = key;
    const copy = this.copy.groups;
    const made = list.map((entry) => entry.origin);
    const tool = (data: string, k: number, icon: IconName, label: string, on: boolean): string =>
      `<button class="tool" type="button" data-${data}="${k}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" aria-pressed="${on}">${ICONS[icon]}</button>`;
    const rows = (state.open ? list : []).map(({ triangles }, k) => {
      const name = describeGroup(made, k, this.names, copy);
      const isHidden = hidden.includes(k);
      const isApart = apart.some((entry) => entry.group === k);
      const classes = ['row', isHidden ? 'row-hidden' : '', target === k ? 'row-selected' : '']
        .filter(Boolean)
        .join(' ');
      // The two tools are the row's own children, not .row-actions, which shows on hover only.
      return `<li class="${classes}" data-group="${k}"><button class="row-main" type="button" data-target="${k}" aria-pressed="${target === k}">${escapeHtml(name)}<small>${triangles.toLocaleString()}</small></button>${tool('shown', k, isHidden ? 'eye-off' : 'eye', `${copy.hide}: ${name}`, isHidden)}${
        k === 0 ? '' : tool('apart', k, 'move-3d', `${copy.pullApart}: ${name}`, isApart)
      }</li>`;
    });
    const isNew = target >= list.length;
    if (state.open)
      rows.push(
        `<li class="row${isNew ? ' row-selected' : ''}" data-group="new"><button class="row-main" type="button" data-target="new" aria-pressed="${isNew}">${escapeHtml(copy.newGroup)}</button></li>`,
      );
    // The focus stays on the control it was on, in its new row: a key press rebuilds the rows.
    const host = this.find('[data-groups]');
    const focused = host.contains(document.activeElement)
      ? (['target', 'shown', 'apart'] as const)
          .map((name) => {
            const value = (document.activeElement as HTMLElement).dataset[name];
            return value === undefined ? null : `[data-${name}="${value}"]`;
          })
          .find((selector) => selector !== null)
      : null;
    host.innerHTML = rows.join('');
    if (focused) host.querySelector<HTMLElement>(focused)?.focus();
  }
}
