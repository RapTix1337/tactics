/* eslint-disable import-x/no-nodejs-modules --
 * ADR-019 keeps production core pure; this test file runs under Node/Vitest
 * and must read the fixture files from disk (10-testing.md §1.1). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getCaseInsensitive, parseKeyValues } from './keyvalues';

const FIXTURES_DIR = fileURLToPath(new URL('../../../../tests/fixtures/steam', import.meta.url));

function readFixture(...segments: string[]): string {
  return readFileSync(join(FIXTURES_DIR, ...segments), 'utf8');
}

function allFixtureFiles(): { label: string; content: string }[] {
  const files: { label: string; content: string }[] = [];
  for (const dir of readdirSync(FIXTURES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(join(FIXTURES_DIR, dir.name))) {
      files.push({ label: `${dir.name}/${file}`, content: readFixture(dir.name, file) });
    }
  }
  return files;
}

describe('parseKeyValues', () => {
  it('parses the real libraryfolders.vdf into the expected tree', () => {
    const result = parseKeyValues(readFixture('real', 'libraryfolders.vdf'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const root = result.root.get('libraryfolders');
    expect(root).toBeInstanceOf(Map);
    if (root === undefined || typeof root === 'string') return;

    const first = root.get('0');
    expect(first).toBeInstanceOf(Map);
    if (first === undefined || typeof first === 'string') return;
    // Escaped backslashes decode to single ones.
    expect(first.get('path')).toBe('C:\\Program Files (x86)\\Steam');
    expect(first.get('apps')).toBeInstanceOf(Map);
  });

  it('never throws on any fixture — malformed input yields named results', () => {
    for (const { label, content } of allFixtureFiles()) {
      expect(() => parseKeyValues(content), label).not.toThrow();
    }
  });

  it('decodes escape sequences and keeps unknown escapes literal', () => {
    const result = parseKeyValues(String.raw`"k" "a\\b\"c\td" "raw" "D:\Lib"`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.get('k')).toBe('a\\b"c\td');
    // `\L` is not a KeyValues escape: files written without escape
    // processing must round-trip their single backslashes.
    expect(result.root.get('raw')).toBe('D:\\Lib');
  });

  it('tolerates comments, CRLF, unquoted tokens, and a BOM', () => {
    const text = '\uFEFF// header comment\r\n"root"\r\n{\r\n\tkey value // trailing\r\n}\r\n';
    const result = parseKeyValues(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = result.root.get('root');
    expect(root).toBeInstanceOf(Map);
    if (root === undefined || typeof root === 'string') return;
    expect(root.get('key')).toBe('value');
  });

  it('lets the last duplicate key win', () => {
    const result = parseKeyValues('"k" "first" "k" "second"');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.get('k')).toBe('second');
  });

  it('keeps __proto__ keys as plain map entries', () => {
    const result = parseKeyValues('"__proto__" { "polluted" "yes" }');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.root.get('__proto__');
    expect(entry).toBeInstanceOf(Map);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('parses empty input to an empty root', () => {
    const result = parseKeyValues('');
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.root.size).toBe(0);
    }
  });

  describe('named errors carry line numbers but never file content', () => {
    const cases: { name: string; text: string }[] = [
      { name: 'unclosed block', text: readFixture('malformed', 'unclosed-brace.vdf') },
      { name: 'stray closing brace', text: readFixture('malformed', 'stray-closing-brace.vdf') },
      { name: 'unterminated string', text: '"key" "value' },
      { name: 'key without value', text: '"root" { "orphan" }' },
      { name: 'block without key', text: '{ "a" "b" }' },
    ];
    for (const { name, text } of cases) {
      it(name, () => {
        const result = parseKeyValues(text);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('NOT_KEYVALUES');
        expect(result.error.issues.length).toBeGreaterThan(0);
        expect(result.error.issues.join(' ')).not.toMatch(/76561|SteamLibrary|orphan/);
      });
    }
  });
});

describe('getCaseInsensitive', () => {
  it('matches keys regardless of casing', () => {
    const result = parseKeyValues('"AppState" { "InstallDir" "x" }');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = getCaseInsensitive(result.root, 'appstate');
    expect(block).toBeInstanceOf(Map);
    if (block === undefined || typeof block === 'string') return;
    expect(getCaseInsensitive(block, 'installdir')).toBe('x');
  });

  it('returns undefined for a missing key', () => {
    expect(getCaseInsensitive(new Map(), 'missing')).toBeUndefined();
  });
});
