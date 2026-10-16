#!/usr/bin/env node
// Runs a command on a copy of the working tree in a throwaway Linux container with a set share of
// the PC (docker/test.Dockerfile), so the checks and the e2e tests neither take every core nor
// leave anything behind but their reports.
//
//   npm run docker:check                       npm run check in the container
//   npm run docker:e2e [-- <playwright args>]  the e2e tests in the container
//   node scripts/docker-test.mjs <command...>  any command
//
// MT_TEST_CPUS (default 4) and MT_TEST_MEMORY (default 8g) set the share. The image is built once
// per lockfile and reused; the reports land in out/docker-test/ (test-results, playwright-report).
// Needs Docker Desktop running.
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const command = process.argv.slice(2);
if (command.length === 0) fail('usage: node scripts/docker-test.mjs <command...>');

const docker = (args, options = {}) =>
  spawnSync('docker', args, { cwd: root, encoding: 'utf8', ...options });

const info = docker(['info', '--format', '{{.NCPU}}']);
if (info.status !== 0) fail('Docker is not running: start Docker Desktop and try again.');
const dockerCpus = Number(info.stdout.trim()) || 1;

const cpus = Math.min(Number(process.env.MT_TEST_CPUS ?? 4), dockerCpus);
const memory = process.env.MT_TEST_MEMORY ?? '8g';

// One image per lockfile, Dockerfile and entrypoint: a change to any of them builds a new one.
const inputs = ['package-lock.json', 'docker/test.Dockerfile', 'docker/test-entrypoint.sh'];
const hash = createHash('sha256');
for (const file of inputs) hash.update(readFileSync(join(root, file)));
const image = `meshtavern-test:${hash.digest('hex').slice(0, 12)}`;

if (docker(['image', 'inspect', image], { stdio: 'ignore' }).status !== 0) {
  console.log(`Building ${image} (once per lockfile)…`);
  const build = docker(['build', '-f', 'docker/test.Dockerfile', '-t', image, '.'], {
    stdio: 'inherit',
  });
  if (build.status !== 0) fail('The test image did not build.');
  // The images of earlier lockfiles are not needed any more.
  const old = docker(['image', 'ls', 'meshtavern-test', '--format', '{{.Repository}}:{{.Tag}}']);
  for (const tag of old.stdout.split('\n').filter((t) => t && t !== image)) {
    docker(['image', 'rm', tag], { stdio: 'ignore' });
  }
  docker(['image', 'prune', '-f', '--filter', 'label=meshtavern-test=1'], { stdio: 'ignore' });
}

// The files to copy in: tracked and new ones, without what .gitignore keeps out (node_modules,
// dist, the corpus, worktrees). Deleted tracked files are left out.
const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
});
if (listed.status !== 0) fail('git ls-files failed: run this inside the repository.');
const files = listed.stdout.split('\0').filter((file) => file && existsSync(join(root, file)));

const out = join(root, 'out', 'docker-test');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

console.log(
  `Running in ${image} on ${cpus} of ${dockerCpus} cores, ${memory} memory: ${command.join(' ')}`,
);
const run = spawn(
  'docker',
  [
    'run',
    '--rm',
    '-i',
    '--init',
    `--cpus=${cpus}`,
    // Pinning the cores makes Node, Vitest and Playwright see only these, so they start as many
    // workers as the container may use instead of one per core of the PC.
    `--cpuset-cpus=0-${Math.max(0, Math.ceil(cpus) - 1)}`,
    `--memory=${memory}`,
    `--memory-swap=${memory}`,
    '--shm-size=1g',
    '--mount',
    `type=bind,source=${root},target=/src,readonly`,
    '--mount',
    `type=bind,source=${out},target=/out`,
    '-e',
    `MT_TEST_CPUS=${cpus}`,
    '-e',
    'PLAYWRIGHT_HTML_OPEN=never',
    ...(process.env.STALL_LIMIT ? ['-e', `STALL_LIMIT=${process.env.STALL_LIMIT}`] : []),
    image,
    ...command,
  ],
  { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] },
);
run.stdin.end(files.join('\0') + '\0');
run.on('exit', (code, signal) => {
  if (existsSync(join(out, 'playwright-report'))) {
    console.log('Reports: out/docker-test/ (playwright-report/index.html, test-results/)');
  }
  process.exit(signal ? 1 : (code ?? 1));
});

function fail(message) {
  console.error(message);
  process.exit(1);
}
