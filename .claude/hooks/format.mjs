// PostToolUse hook: format the file Claude just wrote. Never blocks the edit.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const FORMATTED = new Set(['.ts', '.js', '.mjs', '.json', '.css', '.html', '.md', '.yml', '.yaml']);

let input = '';
for await (const chunk of process.stdin) input += chunk;

try {
  const file = JSON.parse(input).tool_input?.file_path;
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const prettier = join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
  if (file && FORMATTED.has(extname(file)) && existsSync(file) && existsSync(prettier)) {
    execFileSync(process.execPath, [prettier, '--write', '--ignore-unknown', file], {
      cwd: root,
      stdio: 'ignore',
    });
  }
} catch {
  // Formatting is best-effort; CI's format check is the gate.
}
