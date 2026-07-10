import { randomUUID } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';

import type { Logger } from '../../../shared';
import type { Callout } from '../core/map-schema';
import { calloutSchema, parseCalloutList } from '../core/map-schema';
import type { MapProfile, ProfileImageExtension, ProfileWithCallouts } from '../core/profile-model';
import {
  compareByCreation,
  createProfileFromUpload,
  forkProfile as forkProfileModel,
  normalizeProfileName,
  profileImageFileName,
  resolveDefaultProfileId,
} from '../core/profile-model';
import { mapDefaultProfilesTable, mapProfilesTable, profileCalloutsTable } from './schema';

/**
 * The narrow slice of the storage handle this module needs. A structural port
 * on purpose: modules never import each other (ADR-021), so `maps` cannot
 * import `storage` — `app` injects the real StorageDatabase, which satisfies
 * this shape as-is (same pattern as settings, ADR-040).
 */
export interface MapsStoragePort {
  readonly drizzle: BetterSQLite3Database;
  withTransaction<T>(fn: (transaction: BetterSQLite3Database) => T): T;
}

export interface MapProfileList {
  /** All profiles of the map, first by creation. */
  readonly profiles: readonly MapProfile[];
  /**
   * The resolved default: the explicitly marked profile, or the first by
   * creation when none is marked; `undefined` for a map without profiles.
   */
  readonly defaultProfileId: string | undefined;
}

export interface CreateProfileRequest {
  readonly mapId: string;
  readonly name: string;
  readonly imageFileExtension: ProfileImageExtension;
  /**
   * The map's default callout layout the new profile is seeded from. Comes
   * from the registry's already-validated bundled data — not re-validated.
   */
  readonly defaultLayout: readonly Callout[];
}

export interface ForkProfileRequest {
  readonly name: string;
  readonly imageFileExtension: ProfileImageExtension;
}

export interface DeletedProfile {
  readonly mapId: string;
  /** For the caller to delete the profile's image file (E22.2). */
  readonly imageFileName: string;
  /** The map's resolved default after the deletion (first remaining). */
  readonly defaultProfileId: string | undefined;
}

export interface ReplacedProfileImage {
  readonly profile: MapProfile;
  /**
   * The file name before the replace — for the caller to delete the old
   * image file when the extension (and with it the file name) changed.
   */
  readonly previousImageFileName: string;
}

/**
 * Persistence of the profile model (ADR-045, E22.1) via the storage access
 * port. Error semantics follow the settings repositories: invalid input
 * (empty name, malformed callouts) throws `TypeError` and persists nothing;
 * an unknown id is a regular `undefined`/`false` result — the named IPC
 * errors are E22.3's job. `mapId` existence is the caller's concern: the
 * catalog lives in the registry, not here.
 */
export interface ProfileRepository {
  listProfiles(mapId: string): MapProfileList;
  getProfile(profileId: string): ProfileWithCallouts | undefined;
  /** Creates a profile seeded from the default layout (upload flow). */
  createProfile(request: CreateProfileRequest): ProfileWithCallouts;
  /** Copies an existing profile's callouts; `undefined` = source not found. */
  forkProfile(
    sourceProfileId: string,
    request: ForkProfileRequest,
  ): ProfileWithCallouts | undefined;
  renameProfile(profileId: string, name: string): MapProfile | undefined;
  /**
   * Points the profile at a replaced image (E22.3): the file name follows
   * the new extension (`<id>.<ext>`). The caller writes the new file before
   * this update and deletes the previous file after it, so the row never
   * references a missing file.
   */
  replaceImage(
    profileId: string,
    imageFileExtension: ProfileImageExtension,
  ): ReplacedProfileImage | undefined;
  /**
   * Deletes the profile and its callouts. Deleting the marked default clears
   * the marker — resolution then falls back to the first remaining profile
   * deterministically (see `resolveDefaultProfileId`).
   */
  deleteProfile(profileId: string): DeletedProfile | undefined;
  /** `false` when the profile does not exist or belongs to another map. */
  setDefaultProfile(mapId: string, profileId: string): boolean;
  /** Replaces the profile's callout set; validated at this boundary. */
  updateCallouts(profileId: string, callouts: unknown): ProfileWithCallouts | undefined;
}

export interface ProfileRepositoryOptions {
  /** Overridable for deterministic tests. */
  readonly generateId?: () => string;
  readonly now?: () => number;
}

export function createProfileRepository(
  storage: MapsStoragePort,
  logger: Logger,
  options: ProfileRepositoryOptions = {},
): ProfileRepository {
  const generateId = options.generateId ?? randomUUID;
  const now = options.now ?? Date.now;
  const newIdentity = (): { id: string; createdAt: number } => ({
    id: generateId(),
    createdAt: now(),
  });

  return {
    listProfiles(mapId): MapProfileList {
      const profiles = readProfilesOfMap(storage.drizzle, logger, mapId);
      return {
        profiles,
        defaultProfileId: resolveDefaultProfileId(
          profiles,
          readDefaultMarker(storage.drizzle, mapId),
        ),
      };
    },

    getProfile(profileId): ProfileWithCallouts | undefined {
      const profile = readProfile(storage.drizzle, logger, profileId);
      if (profile === undefined) {
        return undefined;
      }
      return { profile, callouts: readCallouts(storage.drizzle, logger, profileId) };
    },

    createProfile(request): ProfileWithCallouts {
      const name = requireValidName(request.name);
      return storage.withTransaction((transaction) => {
        const created = createProfileFromUpload({
          identity: newIdentity(),
          mapId: request.mapId,
          name,
          imageFileExtension: request.imageFileExtension,
          defaultLayout: request.defaultLayout,
        });
        persistNewProfile(transaction, created);
        return created;
      });
    },

    forkProfile(sourceProfileId, request): ProfileWithCallouts | undefined {
      const name = requireValidName(request.name);
      return storage.withTransaction((transaction) => {
        const sourceProfile = readProfile(transaction, logger, sourceProfileId);
        if (sourceProfile === undefined) {
          return undefined;
        }
        const forked = forkProfileModel(
          { profile: sourceProfile, callouts: readCallouts(transaction, logger, sourceProfileId) },
          { identity: newIdentity(), name, imageFileExtension: request.imageFileExtension },
        );
        persistNewProfile(transaction, forked);
        return forked;
      });
    },

    renameProfile(profileId, rawName): MapProfile | undefined {
      const name = requireValidName(rawName);
      return storage.withTransaction((transaction) => {
        const profile = readProfile(transaction, logger, profileId);
        if (profile === undefined) {
          return undefined;
        }
        transaction
          .update(mapProfilesTable)
          .set({ name })
          .where(eq(mapProfilesTable.id, profileId))
          .run();
        return { ...profile, name };
      });
    },

    replaceImage(profileId, imageFileExtension): ReplacedProfileImage | undefined {
      return storage.withTransaction((transaction) => {
        const profile = readProfile(transaction, logger, profileId);
        if (profile === undefined) {
          return undefined;
        }
        const imageFileName = profileImageFileName(profileId, imageFileExtension);
        if (imageFileName !== profile.imageFileName) {
          transaction
            .update(mapProfilesTable)
            .set({ imageFileName })
            .where(eq(mapProfilesTable.id, profileId))
            .run();
        }
        return {
          profile: { ...profile, imageFileName },
          previousImageFileName: profile.imageFileName,
        };
      });
    },

    deleteProfile(profileId): DeletedProfile | undefined {
      return storage.withTransaction((transaction) => {
        const profile = readProfile(transaction, logger, profileId);
        if (profile === undefined) {
          return undefined;
        }
        transaction
          .delete(profileCalloutsTable)
          .where(eq(profileCalloutsTable.profileId, profileId))
          .run();
        transaction.delete(mapProfilesTable).where(eq(mapProfilesTable.id, profileId)).run();
        const remaining = readProfilesOfMap(transaction, logger, profile.mapId);
        const marker = readDefaultMarker(transaction, profile.mapId);
        if (remaining.length === 0 || marker === profileId) {
          // The explicit marker is gone with its profile (or the map is
          // empty); resolution falls back to the first remaining profile.
          transaction
            .delete(mapDefaultProfilesTable)
            .where(eq(mapDefaultProfilesTable.mapId, profile.mapId))
            .run();
        }
        return {
          mapId: profile.mapId,
          imageFileName: profile.imageFileName,
          defaultProfileId: resolveDefaultProfileId(
            remaining,
            readDefaultMarker(transaction, profile.mapId),
          ),
        };
      });
    },

    setDefaultProfile(mapId, profileId): boolean {
      return storage.withTransaction((transaction) => {
        const profile = readProfile(transaction, logger, profileId);
        if (profile === undefined || profile.mapId !== mapId) {
          return false;
        }
        transaction
          .insert(mapDefaultProfilesTable)
          .values({ mapId, profileId })
          .onConflictDoUpdate({ target: mapDefaultProfilesTable.mapId, set: { profileId } })
          .run();
        return true;
      });
    },

    updateCallouts(profileId, callouts): ProfileWithCallouts | undefined {
      const parsed = parseCalloutList(callouts);
      if (!parsed.ok) {
        throw new TypeError(`invalid callouts: ${parsed.issues.join('; ')}`);
      }
      return storage.withTransaction((transaction) => {
        const profile = readProfile(transaction, logger, profileId);
        if (profile === undefined) {
          return undefined;
        }
        transaction
          .delete(profileCalloutsTable)
          .where(eq(profileCalloutsTable.profileId, profileId))
          .run();
        insertCallouts(transaction, profileId, parsed.callouts);
        return { profile, callouts: parsed.callouts };
      });
    },
  };
}

function requireValidName(raw: string): string {
  const name = normalizeProfileName(raw);
  if (name === undefined) {
    throw new TypeError('invalid profile name: must not be empty');
  }
  return name;
}

/**
 * SQLite's dynamic typing means rows may hold anything despite the column
 * types — stored profiles are re-validated on read (CLAUDE.md §5); an invalid
 * row is logged (ids only, ADR-030) and skipped, never fatal.
 */
const storedProfileSchema = z.object({
  id: z.string().min(1),
  mapId: z.string().min(1),
  name: z.string().min(1),
  imageFileName: z.string().min(1),
  createdAt: z.number().int(),
});

function readProfilesOfMap(
  database: BetterSQLite3Database,
  logger: Logger,
  mapId: string,
): readonly MapProfile[] {
  const rows = database
    .select()
    .from(mapProfilesTable)
    .where(eq(mapProfilesTable.mapId, mapId))
    .all();
  return rows.flatMap((row) => decodeProfileRow(row, logger) ?? []).sort(compareByCreation);
}

function readProfile(
  database: BetterSQLite3Database,
  logger: Logger,
  profileId: string,
): MapProfile | undefined {
  const row = database
    .select()
    .from(mapProfilesTable)
    .where(eq(mapProfilesTable.id, profileId))
    .get();
  if (row === undefined) {
    return undefined;
  }
  return decodeProfileRow(row, logger);
}

function decodeProfileRow(row: unknown, logger: Logger): MapProfile | undefined {
  const result = storedProfileSchema.safeParse(row);
  if (!result.success) {
    const id = typeof row === 'object' && row !== null && 'id' in row ? row.id : undefined;
    logger.warn('invalid stored map profile skipped', { profileId: id });
    return undefined;
  }
  return result.data;
}

function readCallouts(
  database: BetterSQLite3Database,
  logger: Logger,
  profileId: string,
): readonly Callout[] {
  const rows = database
    .select()
    .from(profileCalloutsTable)
    .where(eq(profileCalloutsTable.profileId, profileId))
    .orderBy(asc(profileCalloutsTable.name))
    .all();
  return rows.flatMap((row) => {
    const result = calloutSchema.safeParse({ name: row.name, x: row.x, y: row.y });
    if (!result.success) {
      logger.warn('invalid stored profile callout skipped', { profileId });
      return [];
    }
    return [result.data];
  });
}

function readDefaultMarker(database: BetterSQLite3Database, mapId: string): string | null {
  const row = database
    .select()
    .from(mapDefaultProfilesTable)
    .where(eq(mapDefaultProfilesTable.mapId, mapId))
    .get();
  // A non-string value (corrupt row) is treated like no marker at all — the
  // resolution falls back to the first profile by creation.
  return typeof row?.profileId === 'string' ? row.profileId : null;
}

function persistNewProfile(database: BetterSQLite3Database, created: ProfileWithCallouts): void {
  database.insert(mapProfilesTable).values(created.profile).run();
  insertCallouts(database, created.profile.id, created.callouts);
}

function insertCallouts(
  database: BetterSQLite3Database,
  profileId: string,
  callouts: readonly Callout[],
): void {
  if (callouts.length === 0) {
    return;
  }
  database
    .insert(profileCalloutsTable)
    .values(callouts.map((callout) => ({ profileId, ...callout })))
    .run();
}
