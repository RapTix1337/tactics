import { describe, expect, it } from 'vitest';

import type { MapProfileDetails, MapSummary } from './map-catalog';
import {
  calloutListSchema,
  mapProfileDetailsSchema,
  mapSummarySchema,
  profileNameSchema,
} from './map-catalog';

const validProfileSummary = {
  id: '3f2c1a9e-0b5d-4e7f-8a6b-1c2d3e4f5a6b',
  name: 'My radar',
  imageUrl: 'tactics-map://de_dust2/3f2c1a9e-0b5d-4e7f-8a6b-1c2d3e4f5a6b.png',
};

const validSummary: MapSummary = {
  id: 'de_dust2',
  displayName: 'Dust 2',
  profiles: [validProfileSummary],
  defaultProfileId: validProfileSummary.id,
};

const validDetails: MapProfileDetails = {
  ...validProfileSummary,
  mapId: 'de_dust2',
  callouts: [
    { name: 'Ramp', x: 0.3, y: 0.4 },
    { name: 'Outside', x: 0.2, y: 0.5 },
  ],
};

describe('mapSummarySchema', () => {
  it('accepts a catalog summary with profiles and a resolved default', () => {
    expect(mapSummarySchema.safeParse(validSummary).success).toBe(true);
  });

  it('accepts a map without profiles — the empty/upload state (ADR-045)', () => {
    expect(
      mapSummarySchema.safeParse({ id: 'de_nuke', displayName: 'Nuke', profiles: [] }).success,
    ).toBe(true);
  });

  it('rejects empty identifiers and names', () => {
    expect(mapSummarySchema.safeParse({ ...validSummary, id: '' }).success).toBe(false);
    expect(mapSummarySchema.safeParse({ ...validSummary, displayName: '' }).success).toBe(false);
    expect(
      mapSummarySchema.safeParse({
        ...validSummary,
        profiles: [{ ...validProfileSummary, imageUrl: '' }],
      }).success,
    ).toBe(false);
  });
});

describe('mapProfileDetailsSchema', () => {
  it('accepts profile details with callouts and image URL', () => {
    expect(mapProfileDetailsSchema.safeParse(validDetails).success).toBe(true);
  });

  it('accepts an empty callout set — users may delete every callout', () => {
    expect(mapProfileDetailsSchema.safeParse({ ...validDetails, callouts: [] }).success).toBe(true);
  });

  it('rejects callouts outside the normalized 0–1 range', () => {
    expect(
      mapProfileDetailsSchema.safeParse({
        ...validDetails,
        callouts: [{ name: 'Ramp', x: 612, y: 0.4 }],
      }).success,
    ).toBe(false);
    expect(
      mapProfileDetailsSchema.safeParse({
        ...validDetails,
        callouts: [{ name: 'Ramp', x: 0.3, y: -0.1 }],
      }).success,
    ).toBe(false);
  });

  it('rejects an unnamed callout', () => {
    expect(
      mapProfileDetailsSchema.safeParse({
        ...validDetails,
        callouts: [{ name: '', x: 0.3, y: 0.4 }],
      }).success,
    ).toBe(false);
  });
});

describe('calloutListSchema (the maps.updateCallouts boundary)', () => {
  it('rejects duplicate callout names at the boundary', () => {
    expect(
      calloutListSchema.safeParse([
        { name: 'Ramp', x: 0.3, y: 0.4 },
        { name: 'Ramp', x: 0.5, y: 0.6 },
      ]).success,
    ).toBe(false);
  });

  it('caps the set size as the boundary guard', () => {
    const oversized = Array.from({ length: 1_001 }, (_, index) => ({
      name: `c${String(index)}`,
      x: 0.5,
      y: 0.5,
    }));
    expect(calloutListSchema.safeParse(oversized).success).toBe(false);
  });
});

describe('profileNameSchema', () => {
  it('trims surrounding whitespace (matching the module normalization)', () => {
    const parsed = profileNameSchema.safeParse('  My radar ');
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toBe('My radar');
    }
  });

  it('rejects names that are empty after trimming, and over-long names', () => {
    expect(profileNameSchema.safeParse('   ').success).toBe(false);
    expect(profileNameSchema.safeParse('').success).toBe(false);
    expect(profileNameSchema.safeParse('n'.repeat(121)).success).toBe(false);
  });
});
