/**
 * Options from the page address. Anything that is not understood is reported, never
 * guessed at: a mistyped option must not silently change what gets measured.
 */
export interface PageOptions {
  /** Texture size for baked minis, 'auto' for the size policy, 0 for no baking. */
  bake: number | 'auto';
  /** UASTC effort 0–3 for compressed detail textures, or null for uncompressed. */
  ktx: number | null;
  /** One message per option that was ignored. */
  problems: string[];
}

const BAKE_SIZES = [256, 512, 1024, 2048, 4096];
const KNOWN = ['bake', 'ktx', 'settle'];

export function parsePageOptions(search: string): PageOptions {
  const parameters = new URLSearchParams(search);
  const problems: string[] = [];

  let bake: PageOptions['bake'] = 0;
  const bakeValue = parameters.get('bake');
  if (bakeValue === 'auto') bake = 'auto';
  else if (bakeValue !== null && BAKE_SIZES.includes(Number(bakeValue))) bake = Number(bakeValue);
  else if (bakeValue !== null) {
    problems.push(`bake=${bakeValue} ignored: use auto, ${BAKE_SIZES.join(', ')}`);
  }

  let ktx: PageOptions['ktx'] = null;
  const ktxValue = parameters.get('ktx');
  if (ktxValue !== null) {
    const effort = ktxValue === '' ? 1 : Number(ktxValue);
    if ([0, 1, 2, 3].includes(effort)) ktx = effort;
    else problems.push(`ktx=${ktxValue} ignored: use 0, 1, 2 or 3`);
  }

  for (const key of parameters.keys()) {
    if (!KNOWN.includes(key)) problems.push(`unknown option "${key}" ignored`);
  }
  // A "%" typed for "&" glues two options into one value; say so, since it is easy to miss.
  if (/%(?![0-9a-f]{2})/i.test(search)) {
    problems.push('the address contains a stray "%": options are separated by "&"');
  }
  return { bake, ktx, problems };
}
