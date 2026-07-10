export {
  createMapRegistry,
  type MapRegistry,
  type MapRegistryOptions,
} from './adapters/fs-map-registry';
export {
  createProfileImageStore,
  type LoadImageError,
  type LoadImageErrorCode,
  type LoadImageResult,
  type ProfileImageStore,
  type ProfileImageStoreOptions,
  type ValidatedImage,
} from './adapters/profile-image-store';
export {
  createProfileRepository,
  type CreateProfileRequest,
  type DeletedProfile,
  type ForkProfileRequest,
  type MapProfileList,
  type MapsStoragePort,
  type ProfileRepository,
  type ProfileRepositoryOptions,
  type ReplacedProfileImage,
} from './adapters/profile-repository';
export { type MapSummary } from './core/map-index';
export {
  type Callout,
  type CalloutListParseResult,
  type MapData,
  type MapJsonError,
  type MapJsonErrorCode,
  type MapJsonParseResult,
  mapJsonSchema,
  parseCalloutList,
  parseMapJson,
} from './core/map-schema';
export {
  type MapProfile,
  type ProfileImageExtension,
  profileImageFileName,
  type ProfileWithCallouts,
} from './core/profile-model';
