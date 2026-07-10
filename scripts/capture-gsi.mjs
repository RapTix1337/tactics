// GSI capture tool (dev tooling, not app code — E10.1, risk T1): listens for
// CS2 Game State Integration POSTs and dumps each payload as a pretty-printed
// JSON file into the fixture corpus, sorted into the scenario selected via
// stdin. Payloads are sanitized BEFORE they touch the disk (ADR-030): steamid
// values and auth tokens are replaced with placeholders, player sections are
// dropped entirely. Recording instructions: tests/fixtures/gsi/README.md.
//
// Usage: node scripts/capture-gsi.mjs [--port <n>] [--out <dir>]
//   --port  listen port (default 42730, matching the capture cfg)
//   --out   corpus root (default tests/fixtures/gsi/real)
//   keys 1-5 switch the active scenario, q stops the capture
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCENARIOS = ['01-menus', '02-map-load', '03-mid-match', '04-map-change', '05-game-exit'];
const STEAMID_PLACEHOLDER = '76561190000000000';
const TOKEN_PLACEHOLDER = 'REDACTED';
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

// Removes everything the corpus must never contain (ADR-030): any steamid
// value, any auth token, and — defense in depth, the capture cfg subscribes
// only provider + map — any player section CS2 might send anyway.
const sanitize = (value) => {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'player' || key === 'allplayers') {
      continue;
    }
    if (key === 'steamid') {
      result[key] = typeof entry === 'string' ? STEAMID_PLACEHOLDER : entry;
    } else if (key === 'auth' && entry !== null && typeof entry === 'object') {
      result[key] = Object.fromEntries(Object.keys(entry).map((k) => [k, TOKEN_PLACEHOLDER]));
    } else {
      result[key] = sanitize(entry);
    }
  }
  return result;
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
    const sanitized = sanitize(payload);
    const dir = join(outRoot, scenario);
    const file = join(dir, `${String(nextSequence(dir)).padStart(3, '0')}.json`);
    writeFileSync(file, `${JSON.stringify(sanitized, null, 2)}\n`);
    const mapName =
      sanitized !== null && typeof sanitized === 'object' && typeof sanitized.map === 'object'
        ? (sanitized.map?.name ?? '(map section without name)')
        : '(no map section)';
    console.log(`[${scenario}] ${mapName} -> ${file}`);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Capturing GSI payloads on http://127.0.0.1:${port} into ${outRoot}`);
  console.log('Scenario keys: 1=menus 2=map-load 3=mid-match 4=map-change 5=game-exit, q=quit');
  console.log(`Active scenario: ${scenario}`);
});

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (key) => {
    const pressed = key.toString();
    if (pressed === 'q' || pressed === '\u0003') {
      console.log('Capture stopped.');
      server.close();
      process.exit(0);
    }
    const index = Number.parseInt(pressed, 10) - 1;
    if (index >= 0 && index < SCENARIOS.length) {
      scenario = SCENARIOS[index];
      console.log(`Active scenario: ${scenario}`);
    }
  });
}
