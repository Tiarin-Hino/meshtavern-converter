import { DETAIL_EFFORT, DETAIL_EFFORTS } from './pipeline/compress';
import type { UnwrapVariant } from './pipeline/unwrap-parts';

/**
 * Options from the page address, for development only: without any, a mini is baked at the
 * size the policy picks and its texture is compressed. Anything that is not understood is reported, never
 * guessed at: a mistyped option must not silently change what gets measured.
 */
export interface PageOptions {
  /** `?bake=<size>` fixes the texture size of baked minis, `?bake=off` gives 0: no baking. Default 'auto', the size policy. */
  bake: number | 'auto';
  /** `?ktx=0..3` sets the UASTC effort, `?ktx=off` gives null: the texture stays uncompressed. */
  ktx: number | null;
  /**
   * Spike #34: `?unwrap=cut8` cuts the table level into 8 slabs and finds their islands in
   * workers (`&workers=4` for fewer workers than slabs); `?unwrap=whole` keeps the normal
   * unwrap and only adds the spike's figures; `?unwrap=multi8` unwraps the 8 slabs as meshes of
   * one atlas, without workers. `&chart={"maxCost":4}` sets xatlas chart options.
   */
  unwrap?: UnwrapVariant;
  /** One message per option that was ignored. */
  problems: string[];
}

const BAKE_SIZES = [256, 512, 1024, 2048, 4096];
const KNOWN = ['bake', 'ktx', 'settle', 'unwrap', 'workers', 'chart'];

export function parsePageOptions(search: string): PageOptions {
  const parameters = new URLSearchParams(search);
  const problems: string[] = [];

  let bake: PageOptions['bake'] = 'auto';
  const bakeValue = parameters.get('bake');
  if (bakeValue === 'off') bake = 0;
  else if (bakeValue !== null && BAKE_SIZES.includes(Number(bakeValue))) bake = Number(bakeValue);
  else if (bakeValue !== null && bakeValue !== 'auto') {
    problems.push(`bake=${bakeValue} ignored: use auto, off, ${BAKE_SIZES.join(', ')}`);
  }

  let ktx: PageOptions['ktx'] = DETAIL_EFFORT;
  const ktxValue = parameters.get('ktx');
  if (ktxValue === 'off') ktx = null;
  else if (ktxValue !== null) {
    const effort = ktxValue === '' ? DETAIL_EFFORT : Number(ktxValue);
    if ((DETAIL_EFFORTS as readonly number[]).includes(effort)) ktx = effort;
    else problems.push(`ktx=${ktxValue} ignored: use off, ${DETAIL_EFFORTS.join(', ')}`);
  }

  let unwrap: UnwrapVariant | undefined;
  const unwrapValue = parameters.get('unwrap');
  const cut = /^(cut|multi)(\d+)$/.exec(unwrapValue ?? '');
  if (unwrapValue === 'whole' || cut) {
    unwrap = { cut: cut ? Number(cut[2]) : 0 };
    if (cut?.[1] === 'multi') unwrap.together = true;
    const workers = Number(parameters.get('workers'));
    if (workers >= 1) unwrap.workers = workers;
    try {
      const chart = parameters.get('chart');
      if (chart) unwrap.chart = JSON.parse(chart) as UnwrapVariant['chart'];
    } catch {
      problems.push('chart ignored: not JSON');
    }
  } else if (unwrapValue !== null) {
    problems.push(`unwrap=${unwrapValue} ignored: use whole, cut<number> or multi<number>`);
  }

  for (const key of parameters.keys()) {
    if (!KNOWN.includes(key)) problems.push(`unknown option "${key}" ignored`);
  }
  // A "%" typed for "&" glues two options into one value; say so, since it is easy to miss.
  if (/%(?![0-9a-f]{2})/i.test(search)) {
    problems.push('the address contains a stray "%": options are separated by "&"');
  }
  return { bake, ktx, problems, ...(unwrap ? { unwrap } : {}) };
}
