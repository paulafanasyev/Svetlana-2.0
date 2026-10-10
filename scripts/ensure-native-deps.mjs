#!/usr/bin/env node
// Makes sure the native binaries that vite / tailwind / vitest need for THIS
// machine are installed, even if package-lock.json was generated on another OS.
//
// Background: the lockfile was created in a Linux sandbox and only lists the
// linux-x64 builds of rollup, esbuild, lightningcss and @tailwindcss/oxide.
// On Windows (local or the windows-latest CI runner) `npm ci` therefore skips
// the Windows builds and the build crashes with
//   "Cannot find module @rollup/rollup-win32-x64-msvc".
// This script detects the missing platform packages and installs exactly the
// versions the host packages pin, without touching package.json or the lockfile.
//
// Usage:  node scripts/ensure-native-deps.mjs [--dry-run]
// Runs automatically before `npm run build`, `npm run dev` and `npm test`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Packages that ship their native code as per-platform optionalDependencies.
export const NATIVE_HOSTS = Object.freeze(['rollup', 'esbuild', 'lightningcss', '@tailwindcss/oxide']);

const hostKey = (host) => host.split('/').pop();

function isMusl() {
  if (process.platform !== 'linux') return false;
  const report = typeof process.report?.getReport === 'function' ? process.report.getReport() : null;
  return !report?.header?.glibcVersionRuntime;
}

/** All optional deps of `host` built for platform/arch (e.g. both -gnu and -musl). */
export function platformCandidates(host, optionalDependencies, platform, arch) {
  const key = hostKey(host);
  const tag = `${platform}-${arch}`;
  return Object.keys(optionalDependencies || {}).filter((name) => {
    if (!name.includes(key)) return false; // skip unrelated deps like @napi-rs/lzma-*
    const tail = name.split('/').pop();
    return tail === tag || tail.endsWith(`-${tag}`) || tail.includes(`-${tag}-`) || tail.startsWith(`${tag}-`);
  });
}

/** The variant to install when none is present. */
export function pickPlatformPackage(host, optionalDependencies, platform, arch, musl = false) {
  const matches = platformCandidates(host, optionalDependencies, platform, arch);
  if (!matches.length) return null;
  if (platform === 'win32') return matches.find((n) => n.endsWith('-msvc')) || matches[0];
  if (platform === 'linux') return matches.find((n) => n.endsWith(musl ? '-musl' : '-gnu')) || matches[0];
  return matches[0];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** List `name@version` specs that are required on this machine but not installed. */
export function findMissing({ root = ROOT, platform = process.platform, arch = process.arch, musl = isMusl() } = {}) {
  const installed = (name) => fs.existsSync(path.join(root, 'node_modules', name, 'package.json'));
  const missing = [];
  for (const host of NATIVE_HOSTS) {
    const manifest = readJson(path.join(root, 'node_modules', host, 'package.json'));
    if (!manifest) continue; // host not installed, nothing to do
    const deps = manifest.optionalDependencies;
    if (platformCandidates(host, deps, platform, arch).some(installed)) continue;
    const pkg = pickPlatformPackage(host, deps, platform, arch, musl);
    if (pkg) missing.push(`${pkg}@${deps[pkg]}`);
  }
  return missing;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const platform = process.env.ENSURE_NATIVE_PLATFORM || process.platform;
  const arch = process.env.ENSURE_NATIVE_ARCH || process.arch;
  const missing = findMissing({ platform, arch });
  if (!missing.length) {
    console.log(`[native-deps] OK for ${platform}-${arch}`);
    return;
  }
  console.log(`[native-deps] installing missing ${platform}-${arch} binaries: ${missing.join(', ')}`);
  if (dryRun) return;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['install', '--no-save', '--no-audit', '--no-fund', ...missing], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const still = findMissing({ platform, arch });
  if (still.length) {
    console.error(`[native-deps] still missing: ${still.join(', ')}`);
    process.exit(1);
  }
  console.log('[native-deps] done');
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
