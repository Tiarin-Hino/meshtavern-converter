import type { Texture } from 'three';
import {
  groupsApart,
  isGroupTool,
  PAINT_SIZE,
  recentColours,
  TOOL_IDS,
  type Albedo,
  type BrushSettings,
  type IndexedMesh,
  type Look,
  type PaintGroups,
  type PaintMask,
  type PaintRegions,
  type ToolId,
} from '../lib';
import {
  BRUSH_MAX_MM,
  BRUSH_MIN_MM,
  describeGroup,
  mountPainting,
  PAINT_COPY,
  type PaintingState,
  type PaintingView,
  type PickMode,
} from '../lib/painting';

/**
 * The team's Paint tool under ?dev (issue #127, design note `docs/design/painting-engine.md` §13
 * step 5): the painting view mounted over the viewport for the converted mini, with a plain panel
 * of the tools, sliders, colour, regions, Undo, Redo, Save and Close. The test harness for the
 * engine's pixel tests and the PM's tool for judging the brushes (the hobby brushes of #128 with
 * their own sliders and the airbrush's direction, the pipette of #135: Pick, then a tap on
 * the mini takes its colour, the colours used of #136, a swatch each, the groups of #139: a box a
 * group to hide it, the target the group tools add to, a group's fill and mask, and pulling them
 * apart, #180: Pull apart, Put together and a box a group that pulls it apart on its own); not the
 * product page's (it is `data-dev`, removed without ?dev). It uses the entry as any consumer would.
 */

/** What the page has of the converted mini for painting. */
export interface MiniForPainting {
  mesh: IndexedMesh;
  texture: Texture;
  look: Look;
  regions: PaintRegions | null;
  /** The automatic groups (#139): `groupsOf` over what the page kept of the conversion. */
  groups: PaintGroups;
  /** Called when the view is closed: what the page made for it (an uncompressed texture) is released. */
  release?: () => void;
}

/** The tool's hooks: the view's methods, forwarded, and the tool's own open and close. */
export interface PaintHooks {
  /**
   * Opens the view on the converted mini, with a paint and a mask (#138) to continue from, or bare,
   * and its automatic groups unless others are given (#139).
   */
  open: (
    paint?: Albedo | null,
    mask?: PaintMask | null,
    groups?: PaintGroups | null,
  ) => Promise<void>;
  close: () => void;
  /** The view while it is open; its methods are what the tests call. */
  view: () => PaintingView;
  /** The table level being painted, for tests that look for seams and surfaces. */
  table: () => IndexedMesh | null;
  regions: () => PaintRegions | null;
}

/**
 * The sliders each tool has (design note §6), and what its opacity slider is called: the panel
 * shows only those, as a consumer's would.
 */
const SLIDERS: Record<
  ToolId,
  { show: (keyof BrushSettings)[]; opacity: keyof typeof PAINT_COPY.sliders }
> = {
  flat: { show: ['sizeMm', 'hardness', 'opacity'], opacity: 'opacity' },
  eraser: { show: ['sizeMm', 'hardness', 'opacity'], opacity: 'opacity' },
  lift: { show: ['sizeMm', 'hardness', 'opacity'], opacity: 'opacity' },
  fill: { show: ['opacity', 'tolerance'], opacity: 'opacity' },
  wash: { show: ['sizeMm', 'opacity'], opacity: 'strength' },
  ink: { show: ['sizeMm', 'opacity'], opacity: 'flow' },
  dry: { show: ['sizeMm', 'opacity'], opacity: 'pressure' },
  airbrush: { show: ['sizeMm', 'opacity', 'direction'], opacity: 'flow' },
  mask: { show: ['sizeMm', 'hardness', 'opacity'], opacity: 'opacity' },
  unmask: { show: ['sizeMm', 'hardness', 'opacity'], opacity: 'opacity' },
  'mask-fill': { show: ['opacity', 'tolerance'], opacity: 'opacity' },
  'unmask-fill': { show: ['opacity', 'tolerance'], opacity: 'opacity' },
  group: { show: ['sizeMm', 'hardness'], opacity: 'opacity' },
  'group-fill': { show: [], opacity: 'opacity' },
};

type Vec3 = [number, number, number];

/** The airbrush's directions the panel offers: minis stand Y-up, and face +z at the camera's first angle. */
const DIRECTIONS: Record<string, Vec3 | null> = {
  none: null,
  above: [0, 1, 0],
  front: [0, 0, 1],
};

interface Panel {
  open: HTMLButtonElement;
  controls: HTMLElement;
  tools: HTMLElement;
  hint: HTMLElement;
  size: HTMLInputElement;
  hardness: HTMLInputElement;
  opacity: HTMLInputElement;
  opacityLabel: HTMLElement;
  tolerance: HTMLInputElement;
  direction: HTMLSelectElement;
  colour: HTMLInputElement;
  recent: HTMLElement;
  pick: HTMLButtonElement;
  pickMode: HTMLSelectElement;
  base: HTMLButtonElement;
  figure: HTMLButtonElement;
  maskBase: HTMLButtonElement;
  maskFigure: HTMLButtonElement;
  maskClear: HTMLButtonElement;
  maskInvert: HTMLButtonElement;
  maskShow: HTMLButtonElement;
  groups: HTMLElement;
  groupsAll: HTMLButtonElement;
  groupsTint: HTMLButtonElement;
  groupTarget: HTMLSelectElement;
  groupTargetLabel: HTMLElement;
  groupFill: HTMLButtonElement;
  groupMask: HTMLButtonElement;
  groupUnmask: HTMLButtonElement;
  groupsApart: HTMLButtonElement;
  groupsTogether: HTMLButtonElement;
  groupsHint: HTMLElement;
  groupsApartHint: HTMLElement;
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  navigate: HTMLButtonElement;
  save: HTMLButtonElement;
  close: HTMLButtonElement;
  perf: HTMLElement;
}

function findPanel(root: Document): Panel | null {
  const get = <T extends HTMLElement>(id: string): T | null => root.querySelector<T>(`#${id}`);
  const open = get<HTMLButtonElement>('paint-open');
  if (!open) return null;
  return {
    open,
    controls: get('paint-controls')!,
    tools: get('paint-tools')!,
    hint: get('paint-hint')!,
    size: get('paint-size')!,
    hardness: get('paint-hardness')!,
    opacity: get('paint-opacity')!,
    opacityLabel: get('paint-opacity-label')!,
    tolerance: get('paint-tolerance')!,
    direction: get('paint-direction')!,
    colour: get('paint-colour')!,
    recent: get('paint-recent')!,
    pick: get('paint-pick')!,
    pickMode: get('paint-pick-mode')!,
    base: get('paint-base')!,
    figure: get('paint-figure')!,
    maskBase: get('paint-mask-base')!,
    maskFigure: get('paint-mask-figure')!,
    maskClear: get('paint-mask-clear')!,
    maskInvert: get('paint-mask-invert')!,
    maskShow: get('paint-mask-show')!,
    groups: get('paint-groups')!,
    groupsAll: get('paint-groups-all')!,
    groupsTint: get('paint-groups-tint')!,
    groupTarget: get('paint-group-target')!,
    groupTargetLabel: get('paint-group-target-label')!,
    groupFill: get('paint-group-fill')!,
    groupMask: get('paint-group-mask')!,
    groupUnmask: get('paint-group-unmask')!,
    groupsApart: get('paint-groups-apart')!,
    groupsTogether: get('paint-groups-together')!,
    groupsHint: get('paint-groups-hint')!,
    groupsApartHint: get('paint-groups-apart-hint')!,
    undo: get('paint-undo')!,
    redo: get('paint-redo')!,
    navigate: get('paint-navigate')!,
    save: get('paint-save')!,
    close: get('paint-close')!,
    perf: get('paint-perf')!,
  };
}

/**
 * Wires the tool: `host` is the element the view mounts into (over the viewport), `mini` what the
 * page has of the converted mini (null when there is none, or it has no detail texture), and
 * `onState` hears every state the view gives.
 */
export function createPaintTool(
  host: HTMLElement,
  mini: () => MiniForPainting | null,
  onState: (state: PaintingState | null) => void,
): PaintHooks {
  let view: PaintingView | null = null;
  let opened: MiniForPainting | null = null;
  /** Pick is pressed: the next tap on the mini takes its colour instead of painting. */
  let picking = false;
  const panel = findPanel(document);
  /** The history the swatches were last built for: applied and undone steps, rebuilt when it moves. */
  let recentFor = '';
  /** The groups the row was last built for (#139): rebuilt when they change. */
  let groupsFor = '';

  const setPicking = (on: boolean): void => {
    picking = on;
    panel?.pick.setAttribute('aria-pressed', String(on));
  };

  const show = (state: PaintingState): void => {
    onState(state);
    if (!panel) return;
    panel.controls.hidden = !state.open;
    panel.open.hidden = state.open;
    for (const button of panel.tools.querySelectorAll<HTMLButtonElement>('button'))
      button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool));
    panel.size.value = String(state.brush.sizeMm);
    panel.hardness.value = String(state.brush.hardness);
    panel.opacity.value = String(state.brush.opacity);
    panel.tolerance.value = String(state.brush.tolerance);
    const direction = state.brush.direction;
    panel.direction.value =
      Object.entries(DIRECTIONS).find(
        ([, value]) =>
          (value === null) === (direction === null) &&
          (!value || value.every((v, k) => v === direction![k])),
      )?.[0] ?? 'none';
    const sliders = SLIDERS[state.tool];
    for (const label of panel.controls.querySelectorAll<HTMLElement>('[data-slider]'))
      label.hidden = !sliders.show.includes(label.dataset.slider as keyof BrushSettings);
    panel.opacityLabel.textContent = PAINT_COPY.sliders[sliders.opacity];
    panel.hint.textContent = PAINT_COPY.toolHints[state.tool];
    panel.colour.value = state.colour;
    showRecent(state);
    panel.base.disabled = !state.regions.includes('base');
    panel.figure.disabled = !state.regions.includes('figure');
    panel.maskBase.disabled = !state.regions.includes('base');
    panel.maskFigure.disabled = !state.regions.includes('figure');
    panel.maskShow.setAttribute('aria-pressed', String(state.maskShown));
    showGroups(state);
    panel.undo.disabled = state.steps === 0;
    panel.redo.disabled = state.undone === 0;
    panel.navigate.setAttribute('aria-pressed', String(state.navigating));
    const { frames, medianMs, worstMs, slow } = state.perf;
    // Why the last lift stroke took nothing away (#137), while the lift is the tool.
    const refused =
      state.tool === 'lift' && state.lift && 'refused' in state.lift ? state.lift.refused : null;
    panel.perf.textContent = refused
      ? refused === 'too-long-ago'
        ? PAINT_COPY.lift.tooLongAgo
        : PAINT_COPY.lift.nothingPainted
      : frames > 0
        ? `Last stroke: ${frames} frames, median ${medianMs.toFixed(1)} ms, worst ${worstMs.toFixed(1)} ms, ${slow} slow`
        : '';
  };

  /**
   * The groups (#139): a box a group, checked while it is shown, named by `describeGroup` with its
   * triangles, and a second box, checked while it is pulled apart (#180: on its own, by the rule
   * of `groupsApart`; a group the rule leaves in place stays); the target select, every group and
   * New group. Rebuilt when the groups change.
   */
  const showGroups = (state: PaintingState): void => {
    if (!panel) return;
    panel.groupsTint.setAttribute('aria-pressed', String(state.groupTint));
    const { list, hidden, apart, target } = state.groups;
    const key = state.open ? JSON.stringify([list, hidden, apart, target]) : '';
    const none = target >= list.length;
    panel.groupFill.disabled = none;
    panel.groupMask.disabled = none;
    panel.groupUnmask.disabled = none;
    panel.groupsTogether.disabled = apart.length === 0;
    if (key === groupsFor) return;
    groupsFor = key;
    const made = list.map((entry) => entry.origin);
    const names = made.map((_, index) => describeGroup(made, index));
    panel.groups.replaceChildren(
      ...(state.open ? list : []).flatMap(({ triangles }, index) => {
        const label = document.createElement('label');
        label.className = 'check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !hidden.includes(index);
        box.dataset.group = String(index);
        box.addEventListener('change', () => current().setGroupShown(index, box.checked));
        label.append(box, ` ${names[index]} (${triangles.toLocaleString()})`);
        if (index === 0) return [label];
        // Pulled apart on its own (#180): the rule's offset for this group alone.
        const apartLabel = document.createElement('label');
        apartLabel.className = 'check';
        const apartBox = document.createElement('input');
        apartBox.type = 'checkbox';
        apartBox.checked = apart.some((entry) => entry.group === index);
        apartBox.dataset.apart = String(index);
        apartBox.setAttribute('aria-label', `${PAINT_COPY.groups.pullApart}: ${names[index]}`);
        apartBox.addEventListener('change', () => {
          const view = current();
          const offset = apartBox.checked
            ? (groupsApart(opened!.mesh, view.groups(), [index])[0]?.offset ?? null)
            : null;
          view.pullApart(index, offset);
        });
        apartLabel.append(apartBox, ` ${PAINT_COPY.groups.apart}`);
        return [label, apartLabel];
      }),
    );
    const options = (state.open ? names : []).map((name, index) => new Option(name, String(index)));
    options.push(new Option(PAINT_COPY.groups.newGroup, 'new'));
    panel.groupTarget.replaceChildren(...options);
    panel.groupTarget.value = none ? 'new' : String(target);
  };

  /** The colours used as swatches, newest first; a click paints with that colour again. */
  const showRecent = (state: PaintingState): void => {
    if (!panel) return;
    const key = state.open ? `${state.steps}/${state.undone}` : '';
    if (key === recentFor) return;
    recentFor = key;
    const colours = state.open && view ? recentColours(view.history()) : [];
    panel.recent.replaceChildren(
      ...colours.map((colour) => {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'btn btn-sm btn-icon paint-swatch';
        swatch.dataset.colour = colour;
        swatch.style.backgroundColor = colour;
        swatch.setAttribute('aria-label', `${PAINT_COPY.recent.swatch} ${colour}`);
        swatch.title = colour;
        swatch.addEventListener('click', () => current().setColour(colour));
        return swatch;
      }),
    );
    panel.recent.hidden = colours.length === 0;
  };

  const ensureView = (): PaintingView => {
    view ??= mountPainting({ scene: host, onChange: show });
    return view;
  };

  const current = (): PaintingView => {
    if (!view || !view.state.open) throw new Error('The Paint tool is not open');
    return view;
  };

  const open = async (
    paint: Albedo | null = null,
    mask: PaintMask | null = null,
    groups: PaintGroups | null = null,
  ): Promise<void> => {
    const found = mini();
    if (!found) throw new Error('No baked mini to paint');
    close();
    host.hidden = false;
    const painting = ensureView();
    opened = found;
    await painting.open({
      mesh: found.mesh,
      texture: found.texture,
      look: found.look,
      paint,
      mask,
      regions: found.regions,
      groups: groups ?? found.groups,
    });
  };

  const close = (): void => {
    setPicking(false);
    view?.close();
    opened?.release?.();
    opened = null;
    host.hidden = true;
    onState(view ? view.state : null);
  };

  // Before the view's own listeners on its canvas: a tap while picking never reaches the brush.
  host.addEventListener(
    'pointerdown',
    (event) => {
      if (!picking || !view?.state.open || event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      setPicking(false);
      const rect = (host.querySelector('canvas') ?? host).getBoundingClientRect();
      const mode = (panel?.pickMode.value ?? 'shown') as PickMode;
      void view.colourAt(event.clientX - rect.left, event.clientY - rect.top, mode).then((hex) => {
        if (hex) view?.setColour(hex);
        else if (panel) panel.perf.textContent = PAINT_COPY.pick.nothing;
      });
    },
    { capture: true },
  );

  if (panel) {
    panel.pick.textContent = PAINT_COPY.pick.button;
    panel.pick.title = PAINT_COPY.pick.hint;
    panel.pickMode.options[0]!.textContent = PAINT_COPY.pick.shown;
    panel.pickMode.options[1]!.textContent = PAINT_COPY.pick.painted;
    panel.recent.setAttribute('aria-label', PAINT_COPY.recent.label);
    panel.pick.addEventListener('click', () => setPicking(!picking));
    for (const tool of TOOL_IDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm';
      button.dataset.tool = tool;
      button.textContent = PAINT_COPY.tools[tool];
      button.addEventListener('click', () => {
        try {
          const view = current();
          const before = view.state.tool;
          view.setTool(tool);
          // Choosing a group tool shows the groups in their colours; leaving one hides them (#139).
          if (isGroupTool(before) !== isGroupTool(tool)) view.setGroupTint(isGroupTool(tool));
        } catch (error) {
          panel.perf.textContent = error instanceof Error ? error.message : String(error);
        }
      });
      panel.tools.append(button);
    }
    panel.size.min = String(BRUSH_MIN_MM);
    panel.size.max = String(BRUSH_MAX_MM);
    const slider = (input: HTMLInputElement, key: keyof Omit<BrushSettings, 'direction'>): void =>
      input.addEventListener('input', () => current().setBrush({ [key]: Number(input.value) }));
    slider(panel.size, 'sizeMm');
    slider(panel.hardness, 'hardness');
    slider(panel.opacity, 'opacity');
    slider(panel.tolerance, 'tolerance');
    panel.direction.addEventListener('change', () =>
      current().setBrush({ direction: DIRECTIONS[panel.direction.value] ?? null }),
    );
    panel.colour.addEventListener('input', () => current().setColour(panel.colour.value));
    panel.base.addEventListener('click', () => void current().fillRegion('base'));
    panel.figure.addEventListener('click', () => void current().fillRegion('figure'));
    panel.maskBase.textContent = PAINT_COPY.mask.base;
    panel.maskFigure.textContent = PAINT_COPY.mask.figure;
    panel.maskClear.textContent = PAINT_COPY.mask.clear;
    panel.maskInvert.textContent = PAINT_COPY.mask.invert;
    panel.maskShow.textContent = PAINT_COPY.mask.show;
    panel.maskBase.addEventListener('click', () => void current().maskRegion('base'));
    panel.maskFigure.addEventListener('click', () => void current().maskRegion('figure'));
    panel.maskClear.addEventListener('click', () => void current().clearMask());
    panel.maskInvert.addEventListener('click', () => void current().invertMask());
    panel.maskShow.addEventListener('click', () =>
      current().setMaskShown(!current().state.maskShown),
    );
    const groupsCopy = PAINT_COPY.groups;
    panel.groups.setAttribute('aria-label', groupsCopy.label);
    panel.groupsAll.textContent = groupsCopy.showAll;
    panel.groupsTint.textContent = groupsCopy.tint;
    panel.groupTargetLabel.textContent = groupsCopy.into;
    panel.groupFill.textContent = groupsCopy.fill;
    panel.groupMask.textContent = groupsCopy.mask;
    panel.groupUnmask.textContent = groupsCopy.unmask;
    panel.groupsApart.textContent = groupsCopy.pullApart;
    panel.groupsTogether.textContent = groupsCopy.putTogether;
    panel.groupsHint.textContent = groupsCopy.hint;
    panel.groupsApartHint.textContent = groupsCopy.apartHint;
    panel.groupsApart.addEventListener('click', () => current().pullAllApart());
    panel.groupsTogether.addEventListener('click', () => current().putTogether());
    panel.groupsAll.addEventListener('click', () => current().showAllGroups());
    panel.groupsTint.addEventListener('click', () =>
      current().setGroupTint(!current().state.groupTint),
    );
    panel.groupTarget.addEventListener('change', () =>
      current().setGroupTarget(
        panel.groupTarget.value === 'new' ? 'new' : Number(panel.groupTarget.value),
      ),
    );
    const target = (): number => current().state.groups.target;
    panel.groupFill.addEventListener('click', () => void current().fillGroup(target()));
    panel.groupMask.addEventListener('click', () => void current().maskGroup(target(), true));
    panel.groupUnmask.addEventListener('click', () => void current().maskGroup(target(), false));
    panel.undo.addEventListener('click', () => void current().undo());
    panel.redo.addEventListener('click', () => void current().redo());
    panel.navigate.addEventListener('click', () =>
      current().setNavigating(!current().state.navigating),
    );
    panel.save.addEventListener('click', () => void save(current()));
    panel.close.addEventListener('click', close);
    panel.open.addEventListener('click', () => {
      void open().catch((error: unknown) => {
        panel.perf.textContent = error instanceof Error ? error.message : String(error);
      });
    });
  }

  return {
    open,
    close,
    view: current,
    table: () => (view?.state.open ? (opened?.mesh ?? null) : null),
    regions: () => (view?.state.open ? (opened?.regions ?? null) : null),
  };
}

/** Save: the paint as a PNG download, its rows as the texture's (row 0, v = 0, at the top). */
async function save(view: PaintingView): Promise<void> {
  const { data, width, height } = await view.paint();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `paint-${PAINT_SIZE}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
