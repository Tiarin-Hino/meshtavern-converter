// Measures the peak memory of the page's process in real Chrome while it converts given
// STL files, one fresh browser per file: the figures behind the estimate in
// src/lib/pipeline/memory.ts (issue #43). Usage, after `npm run build`:
//   node scripts/measure-memory.mjs corpus/humanoid/some-mini.stl [more.stl …]
// Windows and Linux only: the peak comes from the operating system, not from the page.
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4181;
const MB = 1024 ** 2;
const files = process.argv.slice(2);
if (files.length === 0) throw new Error('Name one or more STL files');

/** Peak memory in bytes of every Chrome process started with this profile folder, by process type. */
function peaks(profile) {
  if (process.platform === 'win32') {
    const script =
      'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\'" | ' +
      'Select-Object CommandLine,PeakWorkingSetSize,PeakPageFileUsage | ConvertTo-Json -Compress';
    const rows = [
      JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', script])),
    ].flat();
    return rows
      .filter((row) => row.CommandLine?.includes(profile))
      .map((row) => ({
        type: row.CommandLine.match(/--type=(\S+)/)?.[1] ?? 'browser',
        // Both are in kilobytes: the peak of resident memory and of committed private memory.
        peakBytes: Math.max(row.PeakWorkingSetSize, row.PeakPageFileUsage) * 1024,
      }));
  }
  const out = [];
  for (const pid of execFileSync('pgrep', ['-f', profile]).toString().trim().split('\n')) {
    // Arguments are separated by NUL bytes, which `\s` does not match.
    const commandLine = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
    const peak = readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmHWM:\s+(\d+)/)?.[1];
    out.push({
      type: commandLine.match(/--type=(\S+)/)?.[1] ?? 'browser',
      peakBytes: Number(peak ?? 0) * 1024,
    });
  }
  return out;
}

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
);
await new Promise((resolve) => setTimeout(resolve, 2500));

try {
  console.log(
    '| File | MB | Triangles | Renderer peak MB | GPU peak MB | Renderer bytes per triangle |',
  );
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const file of files) {
    const profile = mkdtempSync(join(tmpdir(), 'mt-memory-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 760, height: 900 },
    });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForFunction(() => window.__mt?.state.ready === true);
      await page.setInputFiles('#file', file);
      await page.waitForFunction(
        () => (window.__mt.state.stats || window.__mt.state.error) && !window.__mt.state.busy,
        null,
        { timeout: 600_000 },
      );
      const { stats, errorCode } = await page.evaluate(() => window.__mt.state);
      const measured = peaks(profile);
      const peakOf = (type) =>
        Math.max(0, ...measured.filter((p) => p.type === type).map((p) => p.peakBytes));
      const bytes = statSync(file).size;
      console.log(
        `| ${file.split(/[\\/]/).pop()} | ${(bytes / MB).toFixed(1)} | ${stats?.sourceTriangles ?? errorCode} | ` +
          `${(peakOf('renderer') / MB).toFixed(0)} | ${(peakOf('gpu-process') / MB).toFixed(0)} | ` +
          `${stats ? (peakOf('renderer') / stats.sourceTriangles).toFixed(0) : '-'} |`,
      );
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    }
  }
} finally {
  server.kill();
}
