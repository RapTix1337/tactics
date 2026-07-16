/**
 * The slice of Electron's `app.commandLine` the switch applier needs;
 * pure so the exact switches are unit-testable (the options-builder pattern).
 */
export interface CommandLinePort {
  readonly appendSwitch: (key: string, value: string) => void;
}

/**
 * Chromium switches the overlay window needs to stay visible above a
 * borderless fullscreen game (live-overlay 02-design.md §2.1, revised
 * 2026-07-16 after the OVL.9 field test).
 *
 * Chromium's native window occlusion tracker marks every window occluded
 * while a fullscreen-sized foreground window (borderless CS2) is active,
 * and recomputes on any geometry change — the per-window
 * `backgroundThrottling: false` exemption keeps renderer timers alive but
 * not every presentation path (field evidence: overlay invisible after
 * move + game refocus even with desktop composition forced on). Disabling
 * the tracker app-wide is the documented escape hatch; the cost is that
 * fully covered or minimized windows keep rendering.
 *
 * Must run before `app.whenReady()` resolves — Chromium reads the feature
 * list at startup.
 */
export function applyOverlayCompositionSwitches(commandLine: CommandLinePort): void {
  commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}
