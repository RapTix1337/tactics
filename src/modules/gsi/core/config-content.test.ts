import { describe, expect, it } from 'vitest';

import type { GsiTiming } from '../../../shared';
import { generateConfigContent, GSI_CONFIG_FILE_NAME } from './config-content';

const PORT = 42730;
const TOKEN = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';

/** The widened subscription block ships identically in every profile (ADR-051). */
const DATA_BLOCK =
  '    "data"\n' +
  '    {\n' +
  '        "provider" "1"\n' +
  '        "map" "1"\n' +
  '        "map_round_wins" "1"\n' +
  '        "round" "1"\n' +
  '        "player_id" "1"\n' +
  '        "player_state" "1"\n' +
  '        "player_match_stats" "1"\n' +
  '    }\n';

function expectedConfig(buffer: string, throttle: string): string {
  return (
    '"TactiCS"\n' +
    '{\n' +
    '    "uri" "http://127.0.0.1:42730"\n' +
    `    "buffer" "${buffer}"\n` +
    `    "throttle" "${throttle}"\n` +
    '    "heartbeat" "10.0"\n' +
    '    "auth"\n' +
    '    {\n' +
    `        "token" "${TOKEN}"\n` +
    '    }\n' +
    DATA_BLOCK +
    '}\n'
  );
}

describe('generateConfigContent', () => {
  it('renders the slow profile byte for byte (buffer 0.5 / throttle 1.0)', () => {
    expect(generateConfigContent(PORT, TOKEN, 'slow')).toBe(expectedConfig('0.5', '1.0'));
  });

  it('renders the default profile byte for byte (buffer 0.1 / throttle 0.5)', () => {
    expect(generateConfigContent(PORT, TOKEN, 'default')).toBe(expectedConfig('0.1', '0.5'));
  });

  it('renders the fast profile byte for byte (buffer 0.0 / throttle 0.1)', () => {
    expect(generateConfigContent(PORT, TOKEN, 'fast')).toBe(expectedConfig('0.0', '0.1'));
  });

  it('keeps the heartbeat at 10.0 in every profile so the stale timeout is untouched', () => {
    for (const timing of ['slow', 'default', 'fast'] as const satisfies readonly GsiTiming[]) {
      expect(generateConfigContent(PORT, TOKEN, timing)).toContain('"heartbeat" "10.0"');
    }
  });

  it('ships the identical widened data block in all three profiles', () => {
    for (const timing of ['slow', 'default', 'fast'] as const satisfies readonly GsiTiming[]) {
      expect(generateConfigContent(PORT, TOKEN, timing)).toContain(DATA_BLOCK);
    }
  });

  it('points the uri at the given port on loopback', () => {
    expect(generateConfigContent(42733, TOKEN, 'default')).toContain(
      '"uri" "http://127.0.0.1:42733"',
    );
  });

  it('embeds the given token in the auth block', () => {
    expect(generateConfigContent(PORT, 'other-token', 'default')).toContain(
      '"token" "other-token"',
    );
  });

  it('subscribes the widened ADR-051 component set', () => {
    const dataBlock = generateConfigContent(PORT, TOKEN, 'default').split('"data"')[1];
    for (const component of [
      'provider',
      'map',
      'map_round_wins',
      'round',
      'player_id',
      'player_state',
      'player_match_stats',
    ]) {
      expect(dataBlock).toContain(`"${component}" "1"`);
    }
  });

  it('never subscribes positions, weapons, or allplayers (ADR-015 stays structural)', () => {
    for (const timing of ['slow', 'default', 'fast'] as const satisfies readonly GsiTiming[]) {
      const config = generateConfigContent(PORT, TOKEN, timing);
      expect(config).not.toContain('player_position');
      expect(config).not.toContain('player_weapons');
      expect(config).not.toContain('allplayers');
    }
  });

  it('starts with the quoted name line CS2 requires', () => {
    expect(generateConfigContent(PORT, TOKEN, 'default').startsWith('"TactiCS"\n{\n')).toBe(true);
  });

  it('exposes the fixed target file name', () => {
    expect(GSI_CONFIG_FILE_NAME).toBe('gamestate_integration_tactics.cfg');
  });
});
