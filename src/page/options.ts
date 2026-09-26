import { DETAIL_EFFORT, DETAIL_EFFORTS } from '../lib/dev';

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
   * `?dev`, with any value or none, shows the team's tools: figures, stress scene, benchmark,
   * opening a GLB, the compressed download. Independent of `bake` and `ktx`.
   */
  dev: boolean;
  /** One message per option that was ignored. */
  problems: string[];
}

const BAKE_SIZES = [256, 512, 1024, 2048, 4096];
const KNOWN = ['bake', 'ktx', 'settle', 'dev'];

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

  for (const key of parameters.keys()) {
    if (!KNOWN.includes(key)) problems.push(`unknown option "${key}" ignored`);
  }
  // A "%" typed for "&" glues two options into one value; say so, since it is easy to miss.
  if (/%(?![0-9a-f]{2})/i.test(search)) {
    problems.push('the address contains a stray "%": options are separated by "&"');
  }
  return { bake, ktx, dev: parameters.has('dev'), problems };
}
