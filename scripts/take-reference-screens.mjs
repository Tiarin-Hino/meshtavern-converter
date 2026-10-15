// Takes the reference pictures a CI run wrote (#146): every `<picture>-actual.png` under the
// folder given, from the unzipped `reference-screens-actual` artifact, becomes
// `e2e/reference-screens.spec.ts-snapshots/<picture>-chromium-linux.png`. Look at the pictures
// before committing them: docs/guides/reference-screenshots.md.
import { copyFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const SNAPSHOTS = 'e2e/reference-screens.spec.ts-snapshots';
const SUFFIX = '-actual.png';
const PLATFORM = '-chromium-linux.png';

const from = process.argv[2];
if (!from) {
  console.error('Usage: npm run shots:take -- <unzipped reference-screens-actual folder>');
  process.exit(1);
}

/** Every file under `folder`, at any depth. */
function* files(folder) {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

let taken = 0;
for (const path of files(from)) {
  const name = basename(path);
  if (!name.endsWith(SUFFIX)) continue;
  const target = join(SNAPSHOTS, name.slice(0, -SUFFIX.length) + PLATFORM);
  copyFileSync(path, target);
  console.log(target);
  taken++;
}
console.log(`${taken} pictures taken; look at them, then commit ${SNAPSHOTS}.`);
