import type { gsiGetSetupPlan, steamPickCs2Path } from '../../../shared/commands';
import type { CommandResponse } from '../../../shared/contract';
import type { CommandResult } from '../../../shared/envelope';
import { invokeCommand } from './invoke';

/**
 * The setup dialog's command functions (E15.2, 06-ui.md §2). Unlike the
 * catalog these mirror nothing: the stores they would touch (gameState,
 * settings) are event-fed (ADR-033) — main publishes the change, the wiring
 * writes the store. Every function returns the command envelope and never
 * rejects (the invoke.ts skeleton).
 */

/** The `gsi.getSetupPlan` response: a ready plan or the cs2-not-found outcome. */
export type GsiSetupPlan = CommandResponse<typeof gsiGetSetupPlan>;

/** The ready variant — what the dialog previews before the consent click. */
export type ReadyGsiSetupPlan = Extract<GsiSetupPlan, { status: 'ready' }>;

type PickCs2PathResult = CommandResponse<typeof steamPickCs2Path>;

/** Fetches what `gsi.applySetup` would configure via `gsi.getSetupPlan`. */
export async function loadGsiSetupPlan(): Promise<CommandResult<GsiSetupPlan>> {
  return invokeCommand((bridge) => bridge.invoke('gsi.getSetupPlan', undefined));
}

/**
 * Writes the GSI config via `gsi.applySetup` — the contract's only write
 * path, called exclusively from the confirmation dialog (structural consent,
 * ADR-032). Repair is the same call.
 */
export async function applyGsiSetup(): Promise<CommandResult<void>> {
  return invokeCommand((bridge) => bridge.invoke('gsi.applySetup', undefined));
}

/**
 * Opens main's native directory picker via `steam.pickCs2Path` (GSI-02) —
 * the dialog's fallback when the plan answers cs2-not-found. A valid pick is
 * persisted by main and published as `evt:settings.changed`; the caller only
 * needs the outcome to know whether to re-fetch the plan.
 */
export async function pickCs2Path(): Promise<CommandResult<PickCs2PathResult>> {
  return invokeCommand((bridge) => bridge.invoke('steam.pickCs2Path', undefined));
}
