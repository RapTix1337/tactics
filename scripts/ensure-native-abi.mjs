// Ensures better-sqlite3 is built for the requested runtime ABI (risk T2,
// ADR-041): Vitest runs on the system Node ABI, while `pnpm dev` and the
// Playwright E2E launch Electron, which requires its own ABI build. The
// binary is switched only on mismatch; both directions resolve to a prebuilt
// download (seconds, no local build toolchain).
//
// Usage: node scripts/ensure-native-abi.mjs <node|electron>
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

const target = process.argv[2];
if (target !== 'node' && target !== 'electron') {
  console.error('usage: node scripts/ensure-native-abi.mjs <node|electron>');
  process.exit(2);
}

// Probe in a child process: loading the module here would keep the DLL
// locked on Windows and block the rebuild that may follow. Constructing a
// database is required — the native binding loads lazily, a bare require
// never touches it. A clean load means the binary matches the system Node
// ABI; an ABI complaint means it is the Electron build (the only other
// state this script produces); anything else (fresh checkout without a
// binary) just needs a build.
const probe = spawnSync(process.execPath, ['-e', "require('better-sqlite3')(':memory:').close()"], {
  encoding: 'utf8',
});
const current =
  probe.status === 0
    ? 'node'
    : (probe.stderr ?? '').includes('NODE_MODULE_VERSION')
      ? 'electron'
      : 'missing';

if (current === target) {
  process.exit(0);
}

console.log(`[ensure-native-abi] switching better-sqlite3 from ${current} to the ${target} ABI`);
const require = createRequire(import.meta.url);
if (target === 'node') {
  // Re-runs the package's install script (prebuild-install) under system Node.
  execSync('pnpm rebuild better-sqlite3', { stdio: 'inherit' });
} else {
  // prebuild-install is better-sqlite3's own dependency; resolve both through
  // the real package location so pnpm's isolated layout is honored.
  const packageDir = realpathSync(require.resolve('better-sqlite3/package.json')).replace(
    /[\\/]package\.json$/,
    '',
  );
  const packageRequire = createRequire(`${packageDir}/package.json`);
  const prebuildInstall = packageRequire.resolve('prebuild-install/bin.js');
  const electronVersion = require('electron/package.json').version;
  execFileSync(
    process.execPath,
    [prebuildInstall, '--runtime=electron', `--target=${electronVersion}`],
    { stdio: 'inherit', cwd: packageDir },
  );
}
