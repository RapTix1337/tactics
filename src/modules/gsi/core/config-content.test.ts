import { describe, expect, it } from 'vitest';

import { generateConfigContent, GSI_CONFIG_FILE_NAME } from './config-content';

const PORT = 42730;
const TOKEN = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';

describe('generateConfigContent', () => {
  it('renders exactly the E10.1-validated KeyValues block', () => {
    expect(generateConfigContent(PORT, TOKEN)).toBe(
      '"TactiCS"\n' +
        '{\n' +
        '    "uri" "http://127.0.0.1:42730"\n' +
        '    "buffer" "0.1"\n' +
        '    "throttle" "0.5"\n' +
        '    "heartbeat" "10.0"\n' +
        '    "auth"\n' +
        '    {\n' +
        `        "token" "${TOKEN}"\n` +
        '    }\n' +
        '    "data"\n' +
        '    {\n' +
        '        "provider" "1"\n' +
        '        "map" "1"\n' +
        '    }\n' +
        '}\n',
    );
  });

  it('points the uri at the given port on loopback', () => {
    expect(generateConfigContent(42733, TOKEN)).toContain('"uri" "http://127.0.0.1:42733"');
  });

  it('embeds the given token in the auth block', () => {
    expect(generateConfigContent(PORT, 'other-token')).toContain('"token" "other-token"');
  });

  it('subscribes only provider and map (ADR-031/ADR-015)', () => {
    const dataBlock = generateConfigContent(PORT, TOKEN).split('"data"')[1];
    expect(dataBlock).toContain('"provider" "1"');
    expect(dataBlock).toContain('"map" "1"');
    expect(dataBlock).not.toContain('player');
    expect(dataBlock).not.toContain('round');
  });

  it('starts with the quoted name line CS2 requires', () => {
    expect(generateConfigContent(PORT, TOKEN).startsWith('"TactiCS"\n{\n')).toBe(true);
  });

  it('exposes the fixed target file name', () => {
    expect(GSI_CONFIG_FILE_NAME).toBe('gamestate_integration_tactics.cfg');
  });
});
