// Recording-coverage tracker for the GSI capture tool (dev tooling, not app
// code — SCB.1). Watches the RAW payload stream and reports, per game mode,
// which of the seven scenario-critical states the session has already
// produced — so a missed transition (e.g. no bomb plant recorded) is visible
// live in the console instead of after curation. ADR-030-safe by
// construction: steamids are compared transiently, the returned summary
// contains only mode strings and fixed goal labels.

const GOALS = [
  'freezetime',
  'live round',
  'bomb planted',
  'round over',
  'dead-spectate',
  'halftime swap',
  'match end',
];

const asObject = (value) => (value !== null && typeof value === 'object' ? value : undefined);

export const createCoverageTracker = () => {
  // mode → { seen: Set<goal>, ownTeams: Set<team> }
  const byMode = new Map();

  const summaryFor = (mode) => {
    const { seen } = byMode.get(mode);
    const missing = GOALS.filter((goal) => !seen.has(goal));
    const count = `${mode} ${seen.size}/${GOALS.length}`;
    return missing.length === 0 ? count : `${count} (missing: ${missing.join(', ')})`;
  };

  return {
    /** One summary line per observed mode — the startup resume message. */
    summaries() {
      return [...byMode.keys()].map(summaryFor);
    },
    /**
     * Folds one raw payload into the per-mode coverage. Returns the current
     * summary line for the payload's mode ("competitive 4/7 (missing: …)"),
     * or null for payloads without a map mode (menus).
     */
    observe(payload) {
      const root = asObject(payload);
      const map = asObject(root?.map);
      const mode = typeof map?.mode === 'string' ? map.mode : undefined;
      if (!mode) {
        return null;
      }
      if (!byMode.has(mode)) {
        byMode.set(mode, { seen: new Set(), ownTeams: new Set() });
      }
      const { seen, ownTeams } = byMode.get(mode);

      const round = asObject(root?.round);
      if (round?.phase === 'freezetime') seen.add('freezetime');
      if (round?.phase === 'live') seen.add('live round');
      if (round?.phase === 'over') seen.add('round over');
      if (round?.bomb === 'planted') seen.add('bomb planted');
      if (map.phase === 'gameover') seen.add('match end');

      const player = asObject(root?.player);
      const providerSteamid = asObject(root?.provider)?.steamid;
      if (player !== undefined && typeof providerSteamid === 'string') {
        if (player.steamid === providerSteamid) {
          // Only the own player's side counts — a spectated teammate shares
          // it anyway, and spectated enemies must not fake a swap.
          if (typeof player.team === 'string') ownTeams.add(player.team);
          if (ownTeams.size >= 2) seen.add('halftime swap');
        } else {
          seen.add('dead-spectate');
        }
      }

      return summaryFor(mode);
    },
  };
};
