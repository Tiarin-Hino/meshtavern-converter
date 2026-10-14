// Types of icons.mjs, for its unit test.

export const LUCIDE_VERSION: string;
export const ICON_SETS: Record<string, string[]>;
export function iconMarkup(svg: string): string;
export function readIcon(name: string, root?: URL): string;
export function iconModule(path: string, read?: (name: string) => string): Promise<string>;
