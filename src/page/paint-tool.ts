import type { Texture } from 'three';
import {
  PAINT_SIZE,
  TOOL_IDS,
  type Albedo,
  type BrushSettings,
  type IndexedMesh,
  type Look,
  type PaintRegions,
} from '../lib';
import {
  BRUSH_MAX_MM,
  BRUSH_MIN_MM,
  mountPainting,
  PAINT_COPY,
  type PaintingState,
  type PaintingView,
} from '../lib/painting';

/**
 * The team's Paint tool under ?dev (issue #127, design note `docs/design/painting-engine.md` §13
 * step 5): the painting view mounted over the viewport for the converted mini, with a plain panel
 * of the tools, sliders, colour, regions, Undo, Redo, Save and Close. The test harness for the
 * engine's pixel tests and the PM's tool for judging the brushes; not the product page's (it is
 * `data-dev`, removed without ?dev). It uses the entry as any consumer would.
 */

/** What the page has of the converted mini for painting. */
export interface MiniForPainting {
  mesh: IndexedMesh;
  texture: Texture;
  look: Look;
  regions: PaintRegions | null;
  /** Called when the view is closed: what the page made for it (an uncompressed texture) is released. */
  release?: () => void;
}

/** The tool's hooks: the view's methods, forwarded, and the tool's own open and close. */
export interface PaintHooks {
  /** Opens the view on the converted mini, with a paint to continue from or bare. */
  open: (paint?: Albedo | null) => Promise<void>;
  close: () => void;
  /** The view while it is open; its methods are what the tests call. */
  view: () => PaintingView;
  /** The table level being painted, for tests that look for seams and surfaces. */
  table: () => IndexedMesh | null;
  regions: () => PaintRegions | null;
}

interface Panel {
  open: HTMLButtonElement;
  controls: HTMLElement;
  tools: HTMLElement;
  size: HTMLInputElement;
  hardness: HTMLInputElement;
  opacity: HTMLInputElement;
  tolerance: HTMLInputElement;
  colour: HTMLInputElement;
  base: HTMLButtonElement;
  figure: HTMLButtonElement;
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
    size: get('paint-size')!,
    hardness: get('paint-hardness')!,
    opacity: get('paint-opacity')!,
    tolerance: get('paint-tolerance')!,
    colour: get('paint-colour')!,
    base: get('paint-base')!,
    figure: get('paint-figure')!,
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
  const panel = findPanel(document);

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
    panel.colour.value = state.colour;
    panel.base.disabled = !state.regions.includes('base');
    panel.figure.disabled = !state.regions.includes('figure');
    panel.undo.disabled = state.steps === 0;
    panel.redo.disabled = state.undone === 0;
    panel.navigate.setAttribute('aria-pressed', String(state.navigating));
    const { frames, medianMs, worstMs, slow } = state.perf;
    panel.perf.textContent =
      frames > 0
        ? `Last stroke: ${frames} frames, median ${medianMs.toFixed(1)} ms, worst ${worstMs.toFixed(1)} ms, ${slow} slow`
        : '';
  };

  const ensureView = (): PaintingView => {
    view ??= mountPainting({ scene: host, onChange: show });
    return view;
  };

  const current = (): PaintingView => {
    if (!view || !view.state.open) throw new Error('The Paint tool is not open');
    return view;
  };

  const open = async (paint: Albedo | null = null): Promise<void> => {
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
      regions: found.regions,
    });
  };

  const close = (): void => {
    view?.close();
    opened?.release?.();
    opened = null;
    host.hidden = true;
    onState(view ? view.state : null);
  };

  if (panel) {
    for (const tool of TOOL_IDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tool = tool;
      button.textContent = PAINT_COPY.tools[tool];
      button.addEventListener('click', () => {
        try {
          current().setTool(tool);
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
    panel.colour.addEventListener('input', () => current().setColour(panel.colour.value));
    panel.base.addEventListener('click', () => void current().fillRegion('base'));
    panel.figure.addEventListener('click', () => void current().fillRegion('figure'));
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
