#!/usr/bin/env node
// Regenerates package-lock.json so it contains native binaries for every
// platform (Windows, macOS, Linux), not just the one it was created on.
//
// Why: the committed lockfile was generated in a Linux sandbox and only lists
// linux-x64 builds of rollup, esbuild, lightningcss and @tailwindcss/oxide.
// `npm ci` on Windows then installs no Windows binaries and vite/vitest crash
// with "Cannot find module @rollup/rollup-win32-x64-msvc" and similar.
//
// Usage (any OS):  npm run fix:lockfile
//   --check   only verify the current lockfile, do not reinstall
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(root, 'package-lock.json');
const checkOnly = process.argv.includes('--check');

// Every native package below must have a Windows x64 entry in the lockfile.
export const REQUIRED_WINDOWS_ENTRIES = Object.freeze([
  '@rollup/rollup-win32-x64-msvc',
  '@esbuild/win32-x64',
  'lightningcss-win32-x64-msvc',
  '@tailwindcss/oxide-win32-x64-msvc',
]);

export function missingWindowsEntries(lock) {
  const packages = lock?.packages ?? {};
  return REQUIRED_WINDOWS_ENTRIES.filter((name) => !packages[`node_modules/${name}`]);
}

function assertNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    console.error(`Node ${process.versions.node} is too old. Svetlana 2.0 needs Node 22.12+ (vitest 5, supabase-js).`);
    process.exit(1);
  }
}

function check() {
  if (!fs.existsSync(lockPath)) {
    console.error('package-lock.json not found.');
    return false;
  }
  const missing = missingWindowsEntries(JSON.parse(fs.readFileSync(lockPath, 'utf8')));
  if (missing.length) {
    console.error(`Lockfile is missing Windows binaries:\n  ${missing.join('\n  ')}`);
    return false;
  }
  console.log('Lockfile OK: Windows/macOS/Linux native binaries are listed.');
  return true;
}

function main() {
  assertNodeVersion();
  if (checkOnly) process.exit(check() ? 0 : 1);

  console.log('Removing node_modules and package-lock.json ...');
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
  fs.rmSync(lockPath, { force: true });

  console.log('Running a fresh npm install (records optional deps for all platforms) ...');
  execSync('npm install --no-audit --no-fund', { cwd: root, stdio: 'inherit' });

  if (!check()) process.exit(1);
  console.log('\nDone. Commit the new package-lock.json:\n  git add package-lock.json\n  git commit -m "fix: regenerate lockfile with native binaries for all platforms"\n  git push');
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
