import type { CommandResult } from '../../../shared/envelope';
import type { ExternalUrl } from '../../../shared/external-urls';
import { invokeCommand } from './invoke';

/**
 * Opens a contract-allowlisted URL in the default browser via
 * `app.openExternal` (E15.3, ADR-036) — the renderer never navigates
 * (ADR-025). The `ExternalUrl` parameter type keeps callers on the closed
 * allowlist at compile time; main enforces it again at the boundary.
 */
export async function openExternal(url: ExternalUrl): Promise<CommandResult<void>> {
  return invokeCommand((bridge) => bridge.invoke('app.openExternal', { url }));
}
