/**
 * The own-player filter (ADR-052, spec AC 11): while the user is dead and
 * spectating, CS2's `player` block carries the spectated teammate — only a
 * block whose steamid equals the provider steamid is the user's. Uncertainty
 * (either id missing) counts as "not own": the engine freezes the last own
 * snapshot rather than flip (03-plan.md SCB.5 risk note). SteamIDs are
 * compared transiently only — never stored, logged, or emitted (ADR-030).
 */
export function isOwnPlayer(providerSteamId: string | null, playerSteamId: string | null): boolean {
  return providerSteamId !== null && providerSteamId === playerSteamId;
}
