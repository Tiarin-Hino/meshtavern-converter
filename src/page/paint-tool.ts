import type { Texture } from 'three';
import {
  PAINT_SIZE,
  paintAtVertices,
  type Albedo,
  type EngineRun,
  type IndexedMesh,
  type Look,
  type PaintGroups,
  type PaintMask,
  type PaintRegions,
  type PaintStep,
} from '../lib';
import {
  mountPainting,
  PAINT_COPY,
  type PaintingState,
  type PaintingView,
  type PickMode,
} from '../lib/painting';
import { mountPaintingPanel, type PaintingPanel } from '../lib/painting-panel';

/**
 * The team's Paint tool under ?dev (issue #127, design note `docs/design/painting-engine.md` §13
 * step 5): the painting view mounted over the viewport for the converted mini, with the painter's
 * panel of the library on it (#166, design note `docs/design/painting-panel.md` §10: the tools,
 * the sliders, the colour with the pipette and the swatches, the regions, the mask, the groups,
 * the look, Undo and Redo) and a team section for what the product panel does not show: Open, the
 * pipette's mode, Save (the paint as a PNG), Close and the frame counter. The test harness for the
 * engine's pixel tests and the PM's tool for judging the brushes; not the product page's (it is
 * `data-dev`, removed without ?dev). It uses the entries as any consumer would.
 */

/** Steps to replay at open (#165): a paint file's, with the engine each was painted on. */
export interface PaintReplay {
  steps: PaintStep[];
  engines?: EngineRun[] | null;
}

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
   * and its automatic groups unless others are given (#139), and steps to replay, a paint file's
   * (#165).
   */
  open: (
    paint?: Albedo | null,
    mask?: PaintMask | null,
    groups?: PaintGroups | null,
    replay?: PaintReplay | null,
  ) => Promise<void>;
  /**
   * The paint's RGBA at points on the surface (#165), through the closest point on the table level
   * as paintAtVertices samples it: the regression net compares a replayed painting there, in the
   * mini's own space, whatever the unwrap. Four bytes a point; zeros where no surface is near.
   */
  sample: (points: [number, number, number][]) => Promise<number[]>;
  close: () => void;
  /** The view while it is open; its methods are what the tests call. */
  view: () => PaintingView;
  /** The painter's panel the tool mounts on the view (#166), once the tool was first opened. */
  panel: () => PaintingPanel;
  /** The table level being painted, for tests that look for seams and surfaces. */
  table: () => IndexedMesh | null;
  regions: () => PaintRegions | null;
}

interface Team {
  open: HTMLButtonElement;
  controls: HTMLElement;
  pickMode: HTMLSelectElement;
  save: HTMLButtonElement;
  close: HTMLButtonElement;
  perf: HTMLElement;
}

/** The team section (#166, design note `docs/design/painting-panel.md` §10): what the product panel does not show. */
function findTeam(root: Document): Team | null {
  const get = <T extends HTMLElement>(id: string): T | null => root.querySelector<T>(`#${id}`);
  const open = get<HTMLButtonElement>('paint-open');
  if (!open) return null;
  return {
    open,
    controls: get('paint-controls')!,
    pickMode: get('paint-pick-mode')!,
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
  let panel: PaintingPanel | null = null;
  let opened: MiniForPainting | null = null;
  const team = findTeam(document);

  const show = (state: PaintingState): void => {
    onState(state);
    if (!team) return;
    team.controls.hidden = !state.open;
    team.open.hidden = state.open;
    for (const element of [team.pickMode.closest('label')!, team.save, team.close])
      element.hidden = !state.open;
    const { frames, medianMs, worstMs, slow } = state.perf;
    team.perf.textContent =
      frames > 0
        ? `Last stroke: ${frames} frames, median ${medianMs.toFixed(1)} ms, worst ${worstMs.toFixed(1)} ms, ${slow} slow`
        : '';
  };

  /** The view, and the painter's panel on it in the tool's controls (#166), made at the first open. */
  const ensureView = (): PaintingView => {
    if (!view) {
      view = mountPainting({ scene: host, onChange: show });
      if (team)
        panel = mountPaintingPanel({
          view,
          controls: team.controls,
          pickMode: team.pickMode.value as PickMode,
        });
    }
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
    replay: PaintReplay | null = null,
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
      steps: replay?.steps ?? null,
      engines: replay?.engines ?? null,
    });
  };

  const close = (): void => {
    view?.close();
    opened?.release?.();
    opened = null;
    host.hidden = true;
    onState(view ? view.state : null);
  };

  if (team) {
    team.pickMode.options[0]!.textContent = PAINT_COPY.pick.shown;
    team.pickMode.options[1]!.textContent = PAINT_COPY.pick.painted;
    team.pickMode.addEventListener('change', () =>
      panel?.setPickMode(team.pickMode.value as PickMode),
    );
    team.save.addEventListener('click', () => void save(current()));
    team.close.addEventListener('click', close);
    team.open.addEventListener('click', () => {
      void open().catch((error: unknown) => {
        team.perf.textContent = error instanceof Error ? error.message : String(error);
      });
    });
  }

  return {
    open,
    close,
    view: current,
    panel: () => {
      if (!panel) throw new Error('The Paint tool has no panel before it was first opened');
      return panel;
    },
    table: () => (view?.state.open ? (opened?.mesh ?? null) : null),
    regions: () => (view?.state.open ? (opened?.regions ?? null) : null),
    sample: async (points) => {
      const painting = current();
      const albedo = await painting.paint();
      const positions = new Float32Array(points.flat());
      const mesh: IndexedMesh = { positions, indices: new Uint32Array(0) };
      return Array.from(paintAtVertices(mesh, opened!.mesh, albedo));
    },
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
