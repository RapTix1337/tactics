// Payload sanitizer for the GSI capture tool (dev tooling, not app code).
// Removes everything the fixture corpus must never contain (ADR-030) BEFORE
// anything touches the disk:
//
// - `steamid` values → placeholders. The own/other distinction survives:
//   the recorder's own steamid (per the payload's `provider.steamid`) maps
//   to the OWN placeholder, any other steamid to the FOREIGN one — the
//   SCB.1 dead-spectate fixtures must visibly flip the player block, and
//   the capture tool's coverage seeding re-reads stored files.
// - every value inside an `auth` object → REDACTED,
// - `allplayers` sections → dropped entirely (defense in depth — the capture
//   cfg never subscribes them),
// - `player` sections (incl. fragments under `previously`/`added`) → kept,
//   with `name` → "Player" and `clan` → REDACTED. Name replacement is scoped
//   to player subtrees: `provider.name` and `map.name` must survive.
export const STEAMID_PLACEHOLDER = '76561190000000000';
export const FOREIGN_STEAMID_PLACEHOLDER = '76561190000000001';
export const TOKEN_PLACEHOLDER = 'REDACTED';
export const PLAYER_NAME_PLACEHOLDER = 'Player';

export const sanitize = (payload) => {
  const provider =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? payload.provider
      : undefined;
  const ownSteamid =
    provider !== null && typeof provider === 'object' && typeof provider.steamid === 'string'
      ? provider.steamid
      : undefined;
  const placeholderFor = (steamid) =>
    ownSteamid === undefined || steamid === ownSteamid
      ? STEAMID_PLACEHOLDER
      : FOREIGN_STEAMID_PLACEHOLDER;

  const sanitizeNode = (value, inPlayer) => {
    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeNode(entry, inPlayer));
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'allplayers') {
        continue;
      }
      if (key === 'steamid') {
        result[key] =
          typeof entry === 'string' ? placeholderFor(entry) : sanitizeNode(entry, inPlayer);
      } else if (key === 'auth' && entry !== null && typeof entry === 'object') {
        result[key] = Object.fromEntries(Object.keys(entry).map((k) => [k, TOKEN_PLACEHOLDER]));
      } else if (inPlayer && key === 'name') {
        result[key] =
          typeof entry === 'string' ? PLAYER_NAME_PLACEHOLDER : sanitizeNode(entry, inPlayer);
      } else if (inPlayer && key === 'clan') {
        result[key] = typeof entry === 'string' ? TOKEN_PLACEHOLDER : sanitizeNode(entry, inPlayer);
      } else {
        result[key] = sanitizeNode(entry, inPlayer || key === 'player');
      }
    }
    return result;
  };

  return sanitizeNode(payload, false);
};
