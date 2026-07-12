// GSI capture tool (dev tooling, not app code — E10.1/SCB.1, risk T1):
// listens for CS2 Game State Integration POSTs and dumps each payload as a
// pretty-printed JSON file into the fixture corpus, sorted into the scenario
// selected via stdin. Payloads are sanitized BEFORE they touch the disk
// (ADR-030, see gsi-sanitize.mjs): steamids, auth tokens, player names, and
// clan tags are replaced with placeholders; allplayers sections are dropped.
// Recording instructions: tests/fixtures/gsi/README.md.
//
// Usage: node scripts/capture-gsi.mjs [--port <n>] [--out <dir>]
//   --port  listen port (default 42730, matching the capture cfg)
//   --out   corpus root (default tests/fixtures/gsi/real)
//   scenario keys: see SCENARIO_KEYS below, q stops the capture
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCoverageTracker } from './gsi-coverage.mjs';
import { sanitize } from './gsi-sanitize.mjs';

const SCENARIOS = [
  '01-menus',
  '02-map-load',
  '03-mid-match',
  '04-map-change',
  '05-game-exit',
  '06-comp-rounds',
  '07-dead-spectate',
  '08-halftime-swap',
  '09-match-end',
  '10-wingman',
  '11-premier',
];
// One key per scenario, in order: 1–9, then 0, then letters.
const SCENARIO_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'a'];
// Generous safety cap for a localhost dev tool; the app's real per-request
// limit is defined by the intake adapter (E10.4), not here.
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const readArg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const port = Number(readArg('--port', '42730'));
const outRoot = resolve(repoRoot, readArg('--out', join('tests', 'fixtures', 'gsi', 'real')));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('usage: node scripts/capture-gsi.mjs [--port <n>] [--out <dir>]');
  process.exit(2);
}

let scenario = SCENARIOS[0];
const counters = new Map();
const coverage = createCoverageTracker();

// The recording spans multiple script runs (and CS2 restarts): resume the
// coverage from everything already stored, so the counter always reflects
// the whole corpus, not just this session. Works on sanitized files because
// the own/foreign steamid placeholders keep the dead-spectate distinction.
const seedCoverageFromDisk = () => {
  if (!existsSync(outRoot)) {
    return;
  }
  for (const entry of readdirSync(outRoot)) {
    const dir = join(outRoot, entry);
    if (!statSync(dir).isDirectory()) {
      continue;
    }
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) {
        continue;
      }
      try {
        coverage.observe(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      } catch {
        console.warn(`coverage seeding skipped unreadable ${join(entry, file)}`);
      }
    }
  }
};

const nextSequence = (dir) => {
  if (!counters.has(dir)) {
    mkdirSync(dir, { recursive: true });
    const existing = readdirSync(dir)
      .map((file) => Number.parseInt(file, 10))
      .filter(Number.isInteger);
    counters.set(dir, existing.length === 0 ? 0 : Math.max(...existing));
  }
  const next = counters.get(dir) + 1;
  counters.set(dir, next);
  return next;
};

// One-line live feedback per payload so the recorder can verify a transition
// (mode string, round phase, the dead-spectate player flip) was actually
// captured — from the RAW payload, but only ADR-030-safe derivations: the
// own/other verdict compares steamids transiently, no id or name is printed.
const describePayload = (payload) => {
  if (payload === null || typeof payload !== 'object') {
    return '(non-object payload)';
  }
  const map = typeof payload.map === 'object' && payload.map !== null ? payload.map : undefined;
  const round =
    typeof payload.round === 'object' && payload.round !== null ? payload.round : undefined;
  const player =
    typeof payload.player === 'object' && payload.player !== null ? payload.player : undefined;
  const provider =
    typeof payload.provider === 'object' && payload.provider !== null
      ? payload.provider
      : undefined;
  const parts = [];
  if (map) {
    parts.push(`${map.name ?? '(map without name)'} ${map.mode ?? '?'}/${map.phase ?? '?'}`);
    parts.push(`r${map.round ?? '?'}`);
  } else {
    parts.push('(no map section)');
  }
  if (round) {
    parts.push(round.bomb === 'planted' ? `${round.phase ?? '?'}+bomb` : `${round.phase ?? '?'}`);
  }
  if (player) {
    parts.push(player.steamid === provider?.steamid ? 'player:own' : 'player:other');
  } else {
    parts.push('no-player');
  }
  return parts.join(' ');
};

const server = createServer((request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(405).end();
    return;
  }
  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    response.writeHead(200).end();
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      console.warn(`[${scenario}] unparsable payload dropped (${size} bytes)`);
      return;
    }
    const summary = describePayload(payload);
    const modeCoverage = coverage.observe(payload);
    const sanitized = sanitize(payload);
    const dir = join(outRoot, scenario);
    const file = join(dir, `${String(nextSequence(dir)).padStart(3, '0')}.json`);
    writeFileSync(file, `${JSON.stringify(sanitized, null, 2)}\n`);
    console.log(
      `[${scenario}] ${summary} -> ${file}${modeCoverage === null ? '' : ` | ${modeCoverage}`}`,
    );
  });
});

const keyLegend = SCENARIOS.map((name, index) => `${SCENARIO_KEYS[index]}=${name}`).join(' ');

server.listen(port, '127.0.0.1', () => {
  console.log(`Capturing GSI payloads on http://127.0.0.1:${port} into ${outRoot}`);
  console.log(`Scenario keys: ${keyLegend}, q=quit`);
  seedCoverageFromDisk();
  for (const line of coverage.summaries()) {
    console.log(`Resumed coverage: ${line}`);
  }
  console.log(`Active scenario: ${scenario}`);
});

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (key) => {
    const pressed = key.toString();
    // 0x03 = Ctrl+C, which raw mode delivers as data instead of SIGINT.
    if (pressed === 'q' || key[0] === 3) {
      console.log('Capture stopped.');
      server.close();
      process.exit(0);
    }
    const index = SCENARIO_KEYS.indexOf(pressed);
    if (index !== -1 && index < SCENARIOS.length) {
      scenario = SCENARIOS[index];
      console.log(`Active scenario: ${scenario}`);
    }
  });
}
