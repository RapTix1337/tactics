// Zod-free so the renderer can import the URL values by subpath without
// bundling the schemas (the contract-names.ts/constants.ts pattern).

/** The project repository — the MVP-09 "how to contribute" target (E15.3). */
export const PROJECT_REPOSITORY_URL = 'https://github.com/RapTix1337/tactics';

/** The "where do I get a radar image" help target (E22.4 onboarding). */
export const RADAR_IMAGE_HELP_URL = 'https://readtldr.gg/simpleradar';

/**
 * The closed `app.openExternal` allowlist (ADR-036, 03-technical-design.md
 * §5.3): the renderer never navigates (ADR-025), and main opens only URLs
 * from this contract-owned list — the command's request schema is built from
 * it, so anything else fails boundary validation as INVALID_REQUEST. Grows
 * additively with the features that need a new target.
 */
export const EXTERNAL_URLS = [PROJECT_REPOSITORY_URL, RADAR_IMAGE_HELP_URL] as const;

export type ExternalUrl = (typeof EXTERNAL_URLS)[number];
