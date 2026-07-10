import type {
  LoadImageError,
  LoadImageErrorCode,
  MapData,
  MapProfile,
  MapSummary as MapsModuleSummary,
  ProfileImageExtension,
  ProfileImageStore,
  ProfileRepository,
  ProfileWithCallouts,
} from '../../modules/maps';
import { profileImageFileName } from '../../modules/maps';
import type {
  CommandResult,
  Logger,
  MapProfileDetails,
  MapProfileSummary,
  MapSummary,
} from '../../shared';
import {
  failure,
  mapsCreateProfile,
  mapsDeleteProfile,
  mapsGetProfile,
  mapsList,
  mapsRenameProfile,
  mapsReplaceProfileImage,
  mapsSetDefaultProfile,
  mapsUpdateCallouts,
  success,
} from '../../shared';
import { MAP_IMAGE_PROTOCOL_SCHEME } from '../lifecycle/map-image-protocol';
import type { CommandRegistrationDeps } from './register-command';
import { describeError, registerCommand } from './register-command';

/**
 * Dependencies of the maps commands (E22.3): the registry surface, the
 * profile persistence (E22.1), the image store (E22.2), and the native open
 * dialog — all injected so the flows are testable without Electron, a data
 * directory, or a real database (the E9.3 pattern). Type-only module imports
 * keep the contract mapping in one place without duplicating module shapes.
 */
export interface MapsCommandDeps {
  /**
   * Resolves when the startup `loadAll()` scan has finished. Every command
   * awaits it so a fast renderer never sees a half-scanned catalog — without
   * it, a `maps.list` racing the scan would cache an empty sidebar for the
   * whole session.
   */
  readonly mapsLoaded: Promise<void>;
  readonly listMaps: () => readonly MapsModuleSummary[];
  readonly getMap: (mapId: string) => MapData | undefined;
  /** The profile repository (E22.1) — this contract is its first consumer. */
  readonly profiles: ProfileRepository;
  /** The file side (E22.2): validation, save/copy/delete — never raw paths out. */
  readonly images: Pick<ProfileImageStore, 'loadImage' | 'saveImage' | 'copyImage' | 'deleteImage'>;
  /** Native image open dialog; `undefined` on cancel (the steam dialog pattern). */
  readonly showImageOpenDialog: () => Promise<string | undefined>;
}

/**
 * Registers the full ADR-045 maps surface (03-technical-design.md §5.3,
 * E22.3): `maps.list`, `maps.getProfile`, and the mutation commands. Raw
 * module data never crosses as-is — the explicit mapping keeps module fields
 * (`gsiNames`, file names) from silently leaking into the IPC payload;
 * profile images cross only as ready `tactics-map://` URLs.
 *
 * Consistency ordering for the two file-writing flows: create/fork persist
 * the rows first and roll them back when the file step fails; replace writes
 * the new file first and updates the row second — either way no profile row
 * ever points at a missing image file.
 */
export function registerMapsCommands<TEvent>(
  deps: CommandRegistrationDeps<TEvent>,
  maps: MapsCommandDeps,
): void {
  const mapSummaryOf = (map: Pick<MapData, 'id' | 'displayName'>): MapSummary => {
    const profileList = maps.profiles.listProfiles(map.id);
    return {
      id: map.id,
      displayName: map.displayName,
      profiles: profileList.profiles.map(toProfileSummary),
      defaultProfileId: profileList.defaultProfileId,
    };
  };

  /** A profile is only "found" on the map the request names (defense in depth). */
  const findProfileOfMap = (mapId: string, profileId: string): ProfileWithCallouts | undefined => {
    const entry = maps.profiles.getProfile(profileId);
    return entry !== undefined && entry.profile.mapId === mapId ? entry : undefined;
  };

  /**
   * Best-effort compensation when the file step after freshly created rows
   * failed: the rows are removed again so no profile points at a missing
   * image; a failing rollback is logged, never masks the original error.
   */
  const rollbackCreatedProfile = (profileId: string): void => {
    try {
      maps.profiles.deleteProfile(profileId);
    } catch (error) {
      deps.logger.error('Rolling back a created map profile failed', {
        profileId,
        error: describeError(error),
      });
    }
  };

  registerCommand(deps, mapsList, async () => {
    await maps.mapsLoaded;
    return success(maps.listMaps().map(mapSummaryOf));
  });

  registerCommand(deps, mapsGetProfile, async ({ mapId, profileId }) => {
    await maps.mapsLoaded;
    if (maps.getMap(mapId) === undefined) {
      return mapNotFound(mapId);
    }
    const resolvedId = profileId ?? maps.profiles.listProfiles(mapId).defaultProfileId;
    if (resolvedId === undefined) {
      return failure('PROFILE_NOT_FOUND', `Map "${mapId}" has no profiles yet.`);
    }
    const entry = findProfileOfMap(mapId, resolvedId);
    if (entry === undefined) {
      return profileNotFound(mapId, resolvedId);
    }
    return success(toProfileDetails(entry));
  });

  registerCommand(deps, mapsCreateProfile, async ({ mapId, name, source }) => {
    await maps.mapsLoaded;
    const map = maps.getMap(mapId);
    if (map === undefined) {
      return mapNotFound(mapId);
    }

    if (source.kind === 'fork') {
      const sourceEntry = findProfileOfMap(mapId, source.profileId);
      if (sourceEntry === undefined) {
        return profileNotFound(mapId, source.profileId);
      }
      return guarded(deps.logger, 'Forking a map profile', async () => {
        const forked = maps.profiles.forkProfile(source.profileId, {
          name,
          imageFileExtension: imageExtensionOf(sourceEntry.profile.imageFileName),
        });
        if (forked === undefined) {
          return profileNotFound(mapId, source.profileId);
        }
        let copied: boolean;
        try {
          copied = await maps.images.copyImage(
            mapId,
            sourceEntry.profile.imageFileName,
            forked.profile.imageFileName,
          );
        } catch (error) {
          rollbackCreatedProfile(forked.profile.id);
          throw error;
        }
        if (!copied) {
          rollbackCreatedProfile(forked.profile.id);
          return failure('IMAGE_INVALID', 'The source profile has no stored image file.');
        }
        return success({
          status: 'created',
          map: mapSummaryOf(map),
          profile: toProfileDetails(forked),
        } as const);
      });
    }

    const picked = await maps.showImageOpenDialog();
    if (picked === undefined) {
      return success({ status: 'canceled' } as const);
    }
    const loaded = await maps.images.loadImage(picked);
    if (!loaded.ok) {
      return imageInvalid(loaded.error);
    }
    return guarded(deps.logger, 'Creating a map profile', async () => {
      const created = maps.profiles.createProfile({
        mapId,
        name,
        imageFileExtension: loaded.image.extension,
        defaultLayout: map.callouts,
      });
      try {
        await maps.images.saveImage(mapId, created.profile.imageFileName, loaded.image);
      } catch (error) {
        rollbackCreatedProfile(created.profile.id);
        throw error;
      }
      return success({
        status: 'created',
        map: mapSummaryOf(map),
        profile: toProfileDetails(created),
      } as const);
    });
  });

  registerCommand(deps, mapsReplaceProfileImage, async ({ mapId, profileId }) => {
    await maps.mapsLoaded;
    const map = maps.getMap(mapId);
    if (map === undefined) {
      return mapNotFound(mapId);
    }
    if (findProfileOfMap(mapId, profileId) === undefined) {
      return profileNotFound(mapId, profileId);
    }
    const picked = await maps.showImageOpenDialog();
    if (picked === undefined) {
      return success({ status: 'canceled' } as const);
    }
    const loaded = await maps.images.loadImage(picked);
    if (!loaded.ok) {
      return imageInvalid(loaded.error);
    }
    return guarded(deps.logger, 'Replacing a profile image', async () => {
      // New file first, row second, old file last — the row never points at
      // a missing file, whichever step fails.
      const fileName = profileImageFileName(profileId, loaded.image.extension);
      await maps.images.saveImage(mapId, fileName, loaded.image);
      const replaced = maps.profiles.replaceImage(profileId, loaded.image.extension);
      if (replaced === undefined) {
        // The profile vanished between check and write (raced delete):
        // remove the just-written file again.
        await maps.images.deleteImage(mapId, fileName);
        return profileNotFound(mapId, profileId);
      }
      if (replaced.previousImageFileName !== replaced.profile.imageFileName) {
        await maps.images.deleteImage(mapId, replaced.previousImageFileName);
      }
      return success({
        status: 'replaced',
        map: mapSummaryOf(map),
        profile: toProfileDetails({
          profile: replaced.profile,
          callouts: maps.profiles.getProfile(profileId)?.callouts ?? [],
        }),
      } as const);
    });
  });

  registerCommand(deps, mapsSetDefaultProfile, async ({ mapId, profileId }) => {
    await maps.mapsLoaded;
    const map = maps.getMap(mapId);
    if (map === undefined) {
      return mapNotFound(mapId);
    }
    return guarded(deps.logger, 'Setting the default profile', () => {
      if (!maps.profiles.setDefaultProfile(mapId, profileId)) {
        return profileNotFound(mapId, profileId);
      }
      return success(mapSummaryOf(map));
    });
  });

  registerCommand(deps, mapsRenameProfile, async ({ mapId, profileId, name }) => {
    await maps.mapsLoaded;
    const map = maps.getMap(mapId);
    if (map === undefined) {
      return mapNotFound(mapId);
    }
    const entry = findProfileOfMap(mapId, profileId);
    if (entry === undefined) {
      return profileNotFound(mapId, profileId);
    }
    return guarded(deps.logger, 'Renaming a profile', () => {
      const renamed = maps.profiles.renameProfile(profileId, name);
      if (renamed === undefined) {
        return profileNotFound(mapId, profileId);
      }
      return success({
        map: mapSummaryOf(map),
        profile: toProfileDetails({ profile: renamed, callouts: entry.callouts }),
      });
    });
  });

  registerCommand(deps, mapsDeleteProfile, async ({ mapId, profileId }) => {
    await maps.mapsLoaded;
    const map = maps.getMap(mapId);
    if (map === undefined) {
      return mapNotFound(mapId);
    }
    if (findProfileOfMap(mapId, profileId) === undefined) {
      return profileNotFound(mapId, profileId);
    }
    return guarded(deps.logger, 'Deleting a profile', async () => {
      const deleted = maps.profiles.deleteProfile(profileId);
      if (deleted === undefined) {
        return profileNotFound(mapId, profileId);
      }
      // Best-effort by store design: a failing file delete is logged there.
      await maps.images.deleteImage(mapId, deleted.imageFileName);
      return success(mapSummaryOf(map));
    });
  });

  registerCommand(deps, mapsUpdateCallouts, async ({ mapId, profileId, callouts }) => {
    await maps.mapsLoaded;
    if (maps.getMap(mapId) === undefined) {
      return mapNotFound(mapId);
    }
    if (findProfileOfMap(mapId, profileId) === undefined) {
      return profileNotFound(mapId, profileId);
    }
    return guarded(deps.logger, 'Updating callouts', () => {
      const updated = maps.profiles.updateCallouts(profileId, callouts);
      if (updated === undefined) {
        return profileNotFound(mapId, profileId);
      }
      return success(toProfileDetails(updated));
    });
  });
}

function mapNotFound(mapId: string): CommandResult<never> {
  return failure('MAP_NOT_FOUND', `No map data exists for "${mapId}".`);
}

function profileNotFound(mapId: string, profileId: string): CommandResult<never> {
  return failure('PROFILE_NOT_FOUND', `Map "${mapId}" has no profile "${profileId}".`);
}

/** Fixed user-presentable texts — validation details stay in main (ADR-025). */
const IMAGE_INVALID_MESSAGES: Record<LoadImageErrorCode, string> = {
  UNREADABLE: 'The selected file could not be read.',
  TOO_LARGE: 'The selected image file is too large.',
  UNSUPPORTED_TYPE: 'The selected file is not a PNG, JPG, or SVG image.',
  SVG_REJECTED: 'The selected SVG contains disallowed content and was rejected.',
};

function imageInvalid(error: LoadImageError): CommandResult<never> {
  return failure('IMAGE_INVALID', IMAGE_INVALID_MESSAGES[error.code]);
}

/**
 * Runs a mutation sequence: a `TypeError` is contract/module drift — a bug —
 * and rethrows into the INTERNAL path (the steam-commands pattern); anything
 * else thrown is a storage/file failure answered as the named `DB_ERROR`.
 */
async function guarded<T>(
  logger: Logger,
  action: string,
  run: () => CommandResult<T> | Promise<CommandResult<T>>,
): Promise<CommandResult<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof TypeError) {
      throw error;
    }
    logger.error(`${action} failed`, { error: describeError(error) });
    return failure('DB_ERROR', 'The change could not be saved.');
  }
}

const IMAGE_EXTENSIONS: readonly ProfileImageExtension[] = ['png', 'jpg', 'svg'];

/**
 * Extension of a stored image file name (`<id>.<ext>`, E22.1). Stored names
 * come exclusively from `profileImageFileName` — anything else is a bug.
 */
function imageExtensionOf(imageFileName: string): ProfileImageExtension {
  const extension = IMAGE_EXTENSIONS.find((candidate) => imageFileName.endsWith(`.${candidate}`));
  if (extension === undefined) {
    throw new TypeError(`stored image file name has no known extension: "${imageFileName}"`);
  }
  return extension;
}

function toProfileSummary(profile: MapProfile): MapProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    imageUrl: mapImageUrl(profile.mapId, profile.imageFileName),
  };
}

function toProfileDetails(entry: ProfileWithCallouts): MapProfileDetails {
  return {
    id: entry.profile.id,
    mapId: entry.profile.mapId,
    name: entry.profile.name,
    imageUrl: mapImageUrl(entry.profile.mapId, entry.profile.imageFileName),
    callouts: entry.callouts.map(({ name, x, y }) => ({ name, x, y })),
  };
}

function mapImageUrl(mapId: string, imageFileName: string): string {
  return `${MAP_IMAGE_PROTOCOL_SCHEME}://${mapId}/${imageFileName}`;
}
