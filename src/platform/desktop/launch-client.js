/** Native launch IPC transport. It owns no document, settings or window-routing state. */
import { listen } from '@tauri-apps/api/event';
export function createLaunchClient({ invoke, subscribe = handler => listen('mdr:launch-pending', handler) }) {
  return Object.freeze({
    readContext: () => invoke('read_launch_context'),
    setSingleInstance: enabled => invoke('set_single_instance', { enabled }),
    peek: () => invoke('peek_launch_request', undefined, {}, { record: false }),
    acknowledge: id => invoke('ack_launch_request', { id }),
    subscribe
  });
}
