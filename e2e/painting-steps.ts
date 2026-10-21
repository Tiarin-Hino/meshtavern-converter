import { type Page } from '@playwright/test';
import type { EngineRun, PaintStep, UpChoices } from '../src/lib';

/**
 * A painting of every kind of step (#165), shared by the paint file's spec and the promise test
 * (#167): what it gives back is what a paint file holds and the SHA-256 of what it made.
 */

export interface Painted {
  steps: PaintStep[];
  engines: EngineRun[];
  choices: UpChoices;
  paint: string;
  mask: string;
  groups: string;
}

/**
 * Paints a step of every kind on the open figure: the flat brush, the four hobby brushes, the
 * eraser, a lift, the base filled, the figure masked and painted over, the mask cleared, a mask
 * stroke inverted and painted through, a group made and hidden with a stroke behind it. What it
 * gives back is what a paint file holds and the SHA-256 of what it made.
 */
export async function paintEveryKind(page: Page): Promise<Painted> {
  return page.evaluate(async () => {
    const painting = window.__mt.painting;
    await painting.open();
    const view = painting.view();
    const frame = (): Promise<unknown> => new Promise((resolve) => requestAnimationFrame(resolve));
    view.setCamera(0, 5, 1.6);
    await frame();
    const at = (x: number, y: number): [number, number, number] =>
      view.texelAt(...view.screenOf([x, y, 6]))!.point;
    const line = (y: number): [number, number, number][] => [at(-3, y), at(0, y + 1), at(3, y)];
    const brush = { sizeMm: 2, hardness: 0.8, opacity: 1, tolerance: 0.5, direction: null };
    const tool = (id: Parameters<typeof view.setTool>[0], colour: string, changes = {}): void => {
      view.setTool(id);
      view.setBrush({ ...brush, ...changes });
      view.setColour(colour);
    };
    tool('flat', '#b03030');
    await view.stroke(line(12));
    tool('wash', '#202020', { sizeMm: 3, opacity: 0.8 });
    await view.stroke(line(14));
    tool('ink', '#402010');
    await view.stroke(line(16));
    tool('dry', '#e0e0e0', { opacity: 0.6 });
    await view.stroke(line(18));
    tool('airbrush', '#3060c0', { sizeMm: 4, opacity: 0.5, direction: [0, 1, 0] });
    await view.stroke(line(20));
    tool('eraser', '#000000', { sizeMm: 1 });
    await view.stroke([at(-1, 12.5), at(1, 12.5)]);
    tool('lift', '#000000', { sizeMm: 1.5 });
    await view.stroke([at(0, 15), at(1, 15)]);
    tool('fill', '#806040', { opacity: 0.9 });
    await view.fillRegion('base');
    await view.maskRegion('figure');
    tool('flat', '#00ff00', { sizeMm: 6 });
    await view.stroke(line(13));
    await view.clearMask();
    tool('mask', '#000000', { sizeMm: 3 });
    await view.stroke(line(22));
    await view.invertMask();
    tool('flat', '#ffcc00', { sizeMm: 8 });
    await view.stroke(line(21));
    await view.clearMask();
    tool('group', '#000000', { sizeMm: 4 });
    view.setGroupTarget('new');
    await view.stroke(line(17));
    const made = view.state.groups.list.length - 1;
    view.setGroupShown(made, false);
    tool('flat', '#8040a0', { sizeMm: 3 });
    await view.stroke(line(17));
    view.showAllGroups();
    const sha = async (bytes: Uint8Array): Promise<string> =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
    return {
      steps: view.history(),
      engines: view.engines(),
      choices: window.__mt.state.stats!.choices,
      paint: await sha((await view.paint()).data),
      mask: await sha((await view.mask()).data),
      groups: JSON.stringify({ of: Array.from(view.groups().of), made: view.groups().made }),
    };
  });
}
