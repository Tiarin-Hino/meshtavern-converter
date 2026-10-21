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
 * The page's painter (#167, design note `docs/design/painter-on-the-page.md` §3.6; the `?dev` Paint
 * tool of #127 and #166 before it): the painting view mounted over the viewport for the converted
 * mini, with the painter's panel of the library in the panel's `#paint-panel` (the tools, the
 * sliders, the colour with the pipette and the swatches, the regions, the mask, the groups, the
 * look, Undo and Redo), and under `?dev` a team section for what the product panel does not show:
 * the pipette's mode, the paint as a PNG and the frame counter. The view is opened once per
 * conversion and kept open, hidden, after Done (`show(false)`), so that Paint again goes on where it
 * was with its undo. It uses the entries as any consumer would; the page state is `main.ts`'s.
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
  /** The files' names by file index, for the groups' rows (`describeGroup`). */
  names?: readonly string[];
  /** Called when the view is closed: what the page made for it (an uncompressed texture) is released. */
  release?: () => void;
}

/** The painter's hooks: the view's methods, forwarded, and the painter's own open and close. */
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
  /** The painter's panel mounted on the view (#166), once the painter was first opened. */
  panel: () => PaintingPanel;
  /** The table level being painted, for tests that look for seams and surfaces. */
  table: () => IndexedMesh | null;
  regions: () => PaintRegions | null;
}

/** The painter as the page drives it: the hooks, and what only the page calls. */
export interface Painter extends PaintHooks {
  /** The view is open on a mini (shown or hidden). */
  isOpen: () => boolean;
  /** Shows the view or hides it, its frame loop stopped (#167, `PaintingView.setShown`). */
  show: (shown: boolean) => void;
  /** The view, open or not, made at the first open; null before. */
  mounted: () => PaintingView | null;
}

interface Team {
  pickMode: HTMLSelectElement;
  save: HTMLButtonElement;
  perf: HTMLElement;
}

/** The team section (#166, design note `docs/design/painting-panel.md` §10): what the product panel does not show. */
function findTeam(root: Document): Team | null {
  const pickMode = root.querySelector<HTMLSelectElement>('#paint-pick-mode');
  if (!pickMode) return null;
  return {
    pickMode,
    save: root.querySelector<HTMLButtonElement>('#paint-save')!,
    perf: root.querySelector<HTMLElement>('#paint-perf')!,
  };
}

/**
 * Wires the painter: `host` is the element the view mounts into (over the viewport), `controls`
 * the element the panel fills, `mini` what the page has of the converted mini (null when there is
 * none, or it has no detail texture), `palette` the colours kept on this device (#167), and
 * `onState` hears every state the view gives.
 */
export function createPainter(
  host: HTMLElement,
  controls: HTMLElement,
  mini: () => MiniForPainting | null,
  palette: () => readonly string[],
  onState: (state: PaintingState | null) => void,
): Painter {
  let view: PaintingView | null = null;
  let panel: PaintingPanel | null = null;
  let opened: MiniForPainting | null = null;
  const team = findTeam(document);

  const show = (state: PaintingState): void => {
    onState(state);
    if (!team) return;
    const { frames, medianMs, worstMs, slow } = state.perf;
    team.perf.textContent =
      frames > 0
        ? `Last stroke: ${frames} frames, median ${medianMs.toFixed(1)} ms, worst ${worstMs.toFixed(1)} ms, ${slow} slow`
        : '';
  };

  /** The view, and the painter's panel on it (#166), made at the first open. */
  const ensureView = (): PaintingView => {
    if (!view) {
      view = mountPainting({ scene: host, onChange: show });
      panel = mountPaintingPanel({
        view,
        controls,
        palette: palette(),
        pickMode: (team?.pickMode.value as PickMode | undefined) ?? undefined,
      });
    }
    return view;
  };

  const current = (): PaintingView => {
    if (!view || !view.state.open) throw new Error('The painter is not open');
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
    const painting = ensureView();
    painting.setShown(true);
    opened = found;
    panel!.setNames(found.names ?? []);
    panel!.setPalette(palette());
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
    onState(view ? view.state : null);
  };

  if (team) {
    team.pickMode.options[0]!.textContent = PAINT_COPY.pick.shown;
    team.pickMode.options[1]!.textContent = PAINT_COPY.pick.painted;
    team.pickMode.addEventListener('change', () =>
      panel?.setPickMode(team.pickMode.value as PickMode),
    );
    team.save.addEventListener('click', () => void savePng(current()));
  }

  return {
    open,
    close,
    view: current,
    panel: () => {
      if (!panel) throw new Error('The painter has no panel before it was first opened');
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
    isOpen: () => view?.state.open === true,
    show: (shown) => view?.setShown(shown),
    mounted: () => view,
  };
}

/** The paint as a PNG download (the team's Save as PNG), its rows as the texture's (row 0, v = 0, at the top). */
async function savePng(view: PaintingView): Promise<void> {
  const { data, width, height } = await view.paint();
  const blob = await encodePng(data, width, height);
  if (blob) downloadBlob(blob, `paint-${PAINT_SIZE}.png`);
}

/**
 * RGBA bytes as a PNG, with a 2D canvas (#167: the GLB's painted texture too): the canvas is sRGB
 * and converts nothing, and an opaque texture loses nothing to premultiplication.
 */
export async function encodePng(
  data: Uint8Array,
  width: number,
  height: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Hands a blob to the browser as a download named `name`. */
export function downloadBlob(blob: Blob, name: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
