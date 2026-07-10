import type { Callout } from './map-schema';

/**
 * Pure domain logic of the map-profile model (ADR-045, E22.1): a map has 0..n
 * profiles, each owning its image file and its own callout set. Everything
 * here is side-effect free — ids, timestamps, file and database access come
 * from the adapter (`adapters/profile-repository.ts` for persistence, E22.2
 * for the image files).
 */

/** The only image formats a profile may hold (ADR-045). */
export type ProfileImageExtension = 'png' | 'jpg' | 'svg';

export interface MapProfile {
  readonly id: string;
  readonly mapId: string;
  readonly name: string;
  /** File name inside the app-managed image directory (E22.2): `<id>.<ext>`. */
  readonly imageFileName: string;
  /** Creation time in epoch milliseconds; ties are broken by `id`. */
  readonly createdAt: number;
}

export interface ProfileWithCallouts {
  readonly profile: MapProfile;
  readonly callouts: readonly Callout[];
}

/** Id and timestamp for a profile about to be created — the adapter's job. */
export interface NewProfileIdentity {
  readonly id: string;
  readonly createdAt: number;
}

export interface CreateProfileInput {
  readonly identity: NewProfileIdentity;
  readonly mapId: string;
  readonly name: string;
  readonly imageFileExtension: ProfileImageExtension;
  /** The map's default callout layout the new profile is seeded from. */
  readonly defaultLayout: readonly Callout[];
}

export interface ForkProfileInput {
  readonly identity: NewProfileIdentity;
  readonly name: string;
  readonly imageFileExtension: ProfileImageExtension;
}

/** The image file is stored under the profile id — unique by construction. */
export function profileImageFileName(id: string, extension: ProfileImageExtension): string {
  return `${id}.${extension}`;
}

/**
 * A new profile from an uploaded image: callouts are seeded from the map's
 * default layout (ADR-045) so users start from curated names, not an empty
 * map. Copying the file itself is the adapter's job (E22.2).
 */
export function createProfileFromUpload(input: CreateProfileInput): ProfileWithCallouts {
  return {
    profile: {
      id: input.identity.id,
      mapId: input.mapId,
      name: input.name,
      imageFileName: profileImageFileName(input.identity.id, input.imageFileExtension),
      createdAt: input.identity.createdAt,
    },
    callouts: input.defaultLayout.map((callout) => ({ ...callout })),
  };
}

/**
 * A new profile forked from an existing one: same map, callouts copied. The
 * image extension is passed in because the fork's file copy (E22.2) keeps the
 * source's format.
 */
export function forkProfile(
  source: ProfileWithCallouts,
  input: ForkProfileInput,
): ProfileWithCallouts {
  return {
    profile: {
      id: input.identity.id,
      mapId: source.profile.mapId,
      name: input.name,
      imageFileName: profileImageFileName(input.identity.id, input.imageFileExtension),
      createdAt: input.identity.createdAt,
    },
    callouts: source.callouts.map((callout) => ({ ...callout })),
  };
}

/**
 * Profile names are kept as entered, minus surrounding whitespace; a name
 * that is empty after trimming is invalid (`undefined`).
 */
export function normalizeProfileName(raw: string): string | undefined {
  const name = raw.trim();
  return name.length > 0 ? name : undefined;
}

/**
 * "First by creation" — the deterministic order behind the default fallback
 * (ADR-045): `createdAt` ascending, equal timestamps broken by `id` so two
 * profiles created in the same millisecond still order stably.
 */
export function compareByCreation(a: MapProfile, b: MapProfile): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Resolves a map's default profile: the explicitly marked one if it still
 * exists, otherwise the first profile by creation (ADR-045 fallback), or
 * `undefined` for a map without profiles. An orphaned marker (profile gone)
 * is ignored, never an error.
 */
export function resolveDefaultProfileId(
  profiles: readonly MapProfile[],
  markedProfileId: string | null,
): string | undefined {
  if (markedProfileId !== null && profiles.some((profile) => profile.id === markedProfileId)) {
    return markedProfileId;
  }
  return firstByCreation(profiles)?.id;
}

export function firstByCreation(profiles: readonly MapProfile[]): MapProfile | undefined {
  let first: MapProfile | undefined;
  for (const profile of profiles) {
    if (first === undefined || compareByCreation(profile, first) < 0) {
      first = profile;
    }
  }
  return first;
}
