/**
 * One-button benchmark for measuring on other devices (issue #35). It needs no files: the
 * mesh is generated, unless a mini is already loaded, in which case that mini fills the
 * table. The result is a block of Markdown to paste into the issue.
 *
 * It drives the app through the same `window.__mt` hooks the tests use.
 */

import { parsePageOptions } from './options';

/** Seconds each table scene runs before its figures are read. `?settle=1` shortens it for tests. */
const SETTLE_SECONDS = Number(new URLSearchParams(location.search).get('settle') ?? 8);

/** `tiny` is for automated tests only. */
export type BenchmarkSize = 'tiny' | 'light' | 'full';

/**
 * Headroom ramp: displays cap the frame rate, so "60 fps" only says "at least 60". The ramp
 * keeps doubling the number of minis, all at the table level (one level keeps memory low),
 * until the frame rate falls below this share of the best rate seen, or the last step is done.
 */
const RAMP_COUNTS = [200, 400, 800, 1600];
const RAMP_HOLD = 0.85;

/** Quads per side of the generated sheet: 500 → 0.5M triangles (25 MB STL), 1000 → 2M (100 MB). */
const SHEET_QUADS: Record<BenchmarkSize, number> = { tiny: 60, light: 500, full: 1000 };

function gpuName(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'no WebGL 2';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'not exposed';
}

const wait = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export async function runBenchmark(
  size: BenchmarkSize,
  report: (line: string) => void,
): Promise<string> {
  const mt = window.__mt;
  const lines: string[] = [];
  const add = (line: string): void => {
    lines.push(line);
    report(line);
  };
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;

  add(`**Device:** ${navigator.userAgent}`);
  add(
    `**GPU:** ${gpuName()} · **cores:** ${navigator.hardwareConcurrency} · **memory hint:** ${memory ?? 'n/a'} GB · **screen:** ${innerWidth}×${innerHeight} at ×${devicePixelRatio}`,
  );
  add(`**Address:** \`${location.search || '(no options)'}\` · **size:** ${size}`);
  for (const problem of parsePageOptions(location.search).problems) {
    add(`**Option problem:** ${problem}`);
  }
  add('');

  // 1. Conversion. Skipped when the user loaded a real mini: that conversion already happened.
  const ownMini = mt.state.stats !== null && !mt.state.fileName?.startsWith('generated-');
  // The 50 mm sheet has no base and would be Medium, 32 mm apart: copies would overlap.
  // As Large they stand 64 mm apart, near the 50.8 mm of the scenes before the 32 mm grid (#44).
  if (!ownMini) await mt.loadGenerated(SHEET_QUADS[size], { size: 'large' });
  const { stats, baked, error } = mt.state;
  if (error || !stats) {
    add(`**Conversion failed:** ${error ?? 'no result'}`);
    return lines.join('\n');
  }
  add(`| Conversion of ${mt.state.fileName} | |`);
  add('| --- | --- |');
  add(`| Source triangles | ${stats.sourceTriangles.toLocaleString()} |`);
  for (const timing of stats.timings) add(`| ${timing.step} | ${Math.round(timing.ms)} ms |`);
  add(`| Total | ${(stats.totalMs / 1000).toFixed(1)} s |`);
  add(`| Longest stall of the page | ${Math.round(mt.state.longestFrameGapMs)} ms |`);
  add(
    `| Levels | ${stats.lods.map((lod) => `${lod.name} ${lod.triangles.toLocaleString()}`).join(', ')} |`,
  );
  if (baked) {
    add(
      `| Baked | ${baked.resolution} px, ${baked.charts.toLocaleString()} islands${baked.ktx2Bytes ? `, KTX2 ${Math.round(baked.ktx2Bytes / 1024)} KB in ${Math.round(baked.ktx2EncodeMs ?? 0)} ms` : ''} |`,
    );
  }
  add('');

  // 2. Table scenes. The frame rate is capped by the display, so CPU time and the worst frame matter too.
  add('| Table scene | fps | Frame | Worst frame | CPU per frame | Triangles | Baked, textures |');
  add('| --- | --- | --- | --- | --- | --- | --- |');
  const scenes: [string, number, number | null][] = [
    ['100 minis, detail by distance', 100, null],
    ['100 minis, all at table level', 100, 1],
    ['400 minis, detail by distance', 400, null],
  ];
  let spacingMm = 0;
  for (const [label, count, level] of scenes) {
    mt.startStress(count, level);
    await wait(SETTLE_SECONDS);
    const perf = mt.state.perf;
    if (!perf) continue;
    spacingMm = perf.stressSpacingMm;
    add(
      `| ${label} | ${perf.fps.toFixed(0)} | ${perf.frameMs.toFixed(1)} ms | ${perf.worstFrameMs.toFixed(0)} ms | ${perf.renderCpuMs.toFixed(1)} ms | ${perf.triangles.toLocaleString()} | ${perf.bakedMinis}, ${Math.round(perf.textureBytes / 1048576)} MB |`,
    );
  }
  // Scenes before #44 stood every mini 50.8 mm apart; since then by its footprint.
  add('');
  add(`Minis stand ${spacingMm} mm apart, their footprint on the 32 mm grid.`);
  // 3. Headroom.
  let best = 0;
  let held = { count: 0, triangles: 0 };
  let dropped: string | null = null;
  add('');
  add(
    '| Headroom ramp, all at table level | fps | Worst frame | CPU per frame | Triangles | Baked, textures |',
  );
  add('| --- | --- | --- | --- | --- | --- |');
  for (const count of [100, ...RAMP_COUNTS]) {
    mt.startStress(count, 1);
    await wait(Math.min(SETTLE_SECONDS, 5));
    const perf = mt.state.perf;
    if (!perf) break;
    add(
      `| ${count} minis | ${perf.fps.toFixed(0)} | ${perf.worstFrameMs.toFixed(0)} ms | ${perf.renderCpuMs.toFixed(1)} ms | ${perf.triangles.toLocaleString()} | ${perf.bakedMinis}, ${Math.round(perf.textureBytes / 1048576)} MB |`,
    );
    best = Math.max(best, perf.fps);
    if (perf.fps < best * RAMP_HOLD) {
      dropped = `${count} minis (${perf.fps.toFixed(0)} fps)`;
      break;
    }
    held = { count, triangles: perf.triangles };
  }
  add('');
  add(
    `**Headroom:** holds its display rate (${best.toFixed(0)} fps) up to ${held.count} minis at table level, ${(held.triangles / 1e6).toFixed(1)} M triangles per frame; ${dropped ? `drops at ${dropped}` : 'never dropped, the ramp ended first'}.`,
  );

  mt.stopStress();
  return lines.join('\n');
}
