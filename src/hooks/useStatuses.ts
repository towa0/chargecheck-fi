import { useEffect, useState } from 'react';
import { createStatusPoller, type FetchLike, type StatusMap, type Visibility } from '../live/statuses.ts';

export interface StatusState {
  statuses: StatusMap | null;
  error: boolean;
}

export function useStatuses(fetchFn: FetchLike | null, visibility: Visibility | null): StatusState {
  const [state, setState] = useState<StatusState>({ statuses: null, error: false });

  useEffect(() => {
    if (!fetchFn || !visibility) return undefined;
    const poller = createStatusPoller({
      fetch: fetchFn,
      visibility,
      onUpdate: (statuses) => setState({ statuses, error: false }),
      onError: () => setState((s) => ({ ...s, error: true })),
    });
    poller.start();
    return () => poller.stop();
  }, [fetchFn, visibility]);

  return state;
}
