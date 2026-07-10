import { describe, expect, it } from 'vitest';

import type { Callout } from './map-schema';
import type { MapProfile } from './profile-model';
import {
  compareByCreation,
  createProfileFromUpload,
  firstByCreation,
  forkProfile,
  normalizeProfileName,
  profileImageFileName,
  resolveDefaultProfileId,
} from './profile-model';

const LAYOUT: readonly Callout[] = [
  { name: 'A Site', x: 0.2, y: 0.3 },
  { name: 'Mid', x: 0.5, y: 0.5 },
];

function profile(overrides: Partial<MapProfile>): MapProfile {
  return {
    id: 'p1',
    mapId: 'de_dust2',
    name: 'Default',
    imageFileName: 'p1.png',
    createdAt: 1000,
    ...overrides,
  };
}

describe('createProfileFromUpload', () => {
  it('seeds the callouts from the default layout as independent copies', () => {
    const created = createProfileFromUpload({
      identity: { id: 'new-id', createdAt: 42 },
      mapId: 'de_dust2',
      name: 'My radar',
      imageFileExtension: 'png',
      defaultLayout: LAYOUT,
    });

    expect(created.callouts).toEqual(LAYOUT);
    expect(created.callouts[0]).not.toBe(LAYOUT[0]);
  });

  it('derives the image file name from the profile id and extension', () => {
    const created = createProfileFromUpload({
      identity: { id: 'new-id', createdAt: 42 },
      mapId: 'de_dust2',
      name: 'My radar',
      imageFileExtension: 'svg',
      defaultLayout: [],
    });

    expect(created.profile).toEqual({
      id: 'new-id',
      mapId: 'de_dust2',
      name: 'My radar',
      imageFileName: 'new-id.svg',
      createdAt: 42,
    });
  });
});

describe('forkProfile', () => {
  it('copies the source callouts onto a new profile of the same map', () => {
    const source = {
      profile: profile({ id: 'src', imageFileName: 'src.jpg' }),
      callouts: LAYOUT,
    };

    const forked = forkProfile(source, {
      identity: { id: 'copy', createdAt: 2000 },
      name: 'Fork',
      imageFileExtension: 'jpg',
    });

    expect(forked.profile).toEqual({
      id: 'copy',
      mapId: 'de_dust2',
      name: 'Fork',
      imageFileName: 'copy.jpg',
      createdAt: 2000,
    });
    expect(forked.callouts).toEqual(LAYOUT);
    expect(forked.callouts[0]).not.toBe(LAYOUT[0]);
  });
});

describe('normalizeProfileName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeProfileName('  My radar ')).toBe('My radar');
  });

  it.each(['', '   ', '\t\n'])('rejects %j as empty', (raw) => {
    expect(normalizeProfileName(raw)).toBeUndefined();
  });
});

describe('profileImageFileName', () => {
  it('joins id and extension', () => {
    expect(profileImageFileName('abc', 'png')).toBe('abc.png');
  });
});

describe('creation order', () => {
  const older = profile({ id: 'b', createdAt: 1000 });
  const newer = profile({ id: 'a', createdAt: 2000 });
  const olderTwin = profile({ id: 'a', createdAt: 1000 });

  it('orders by createdAt ascending', () => {
    expect(compareByCreation(older, newer)).toBeLessThan(0);
    expect(compareByCreation(newer, older)).toBeGreaterThan(0);
  });

  it('breaks same-millisecond ties by id', () => {
    expect(compareByCreation(olderTwin, older)).toBeLessThan(0);
    expect(compareByCreation(older, olderTwin)).toBeGreaterThan(0);
    expect(compareByCreation(older, profile({ id: 'b', createdAt: 1000 }))).toBe(0);
  });

  it('firstByCreation picks the oldest, tie-broken by id', () => {
    expect(firstByCreation([newer, older, olderTwin])).toBe(olderTwin);
    expect(firstByCreation([])).toBeUndefined();
  });
});

describe('resolveDefaultProfileId', () => {
  const profiles = [
    profile({ id: 'second', createdAt: 2000 }),
    profile({ id: 'first', createdAt: 1000 }),
  ];

  it('prefers the explicitly marked profile', () => {
    expect(resolveDefaultProfileId(profiles, 'second')).toBe('second');
  });

  it('falls back to the first by creation when nothing is marked', () => {
    expect(resolveDefaultProfileId(profiles, null)).toBe('first');
  });

  it('ignores an orphaned marker', () => {
    expect(resolveDefaultProfileId(profiles, 'gone')).toBe('first');
  });

  it('resolves to undefined for a map without profiles', () => {
    expect(resolveDefaultProfileId([], 'gone')).toBeUndefined();
    expect(resolveDefaultProfileId([], null)).toBeUndefined();
  });
});
