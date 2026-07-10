import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import { failure } from '../../../shared/envelope';
import { getBridge } from './bridge';

/**
 * The renderer's shared invoke skeleton (extracted on its second consumer,
 * E15.2): bridge lookup, envelope passthrough, rejections converted to
 * failed envelopes — callers always get a `CommandResult`, never a
 * rejection (the bootstrap precedent).
 */
export async function invokeCommand<TData>(
  invoke: (bridge: TacticsBridge) => Promise<CommandResult<TData>>,
): Promise<CommandResult<TData>> {
  const bridge = getBridge();
  if (bridge === undefined) {
    return failure('INTERNAL', 'IPC bridge is not exposed on window');
  }
  try {
    return await invoke(bridge);
  } catch (error) {
    return failure('INTERNAL', error instanceof Error ? error.message : String(error));
  }
}
