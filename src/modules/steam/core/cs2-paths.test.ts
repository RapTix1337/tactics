import { describe, expect, it } from 'vitest';

import { deriveCs2Paths } from './cs2-paths';

describe('deriveCs2Paths', () => {
  it('derives the game root and cfg dir for the default Windows library', () => {
    expect(
      deriveCs2Paths('C:\\Program Files (x86)\\Steam', 'Counter-Strike Global Offensive'),
    ).toEqual({
      gameRoot:
        'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive',
      cfgDir:
        'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg',
    });
  });

  it('keeps forward slashes for POSIX-style library paths', () => {
    expect(deriveCs2Paths('/home/user/.steam/steam', 'Counter-Strike Global Offensive')).toEqual({
      gameRoot: '/home/user/.steam/steam/steamapps/common/Counter-Strike Global Offensive',
      cfgDir:
        '/home/user/.steam/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg',
    });
  });

  it('trims trailing separators before joining', () => {
    expect(deriveCs2Paths('D:\\SteamLibrary\\', 'Counter-Strike Global Offensive').gameRoot).toBe(
      'D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive',
    );
  });

  it('handles a drive-root library', () => {
    expect(deriveCs2Paths('D:\\', 'Counter-Strike Global Offensive').gameRoot).toBe(
      'D:\\steamapps\\common\\Counter-Strike Global Offensive',
    );
  });
});
