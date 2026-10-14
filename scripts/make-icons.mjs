#!/usr/bin/env node
// Writes the icon modules of scripts/lib/icons.mjs from the pinned lucide-static package (#143).
// Run after changing a list there or the package's version: npm run icons.

import { writeFileSync } from 'node:fs';
import { ICON_SETS, iconModule } from './lib/icons.mjs';

for (const path of Object.keys(ICON_SETS)) {
  writeFileSync(new URL(`../${path}`, import.meta.url), await iconModule(path));
  console.log(`${path}: ${ICON_SETS[path].length} icons`);
}
