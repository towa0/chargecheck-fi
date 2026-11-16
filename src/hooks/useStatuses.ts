import { useEffect, useState } from 'react';
import { createStatusPoller, type FetchLike, type StatusMap, type Visibility } from '../live/statuses.ts';

export interface StatusState {
  statuses: StatusMap | null;
  error: boolean;
  /** Pages received so far in the first full load. */
  pages: number;
}

export function useStatuses(fetchFn: FetchLike | null, visibility: Visibility | null): StatusState {
  const [state, setState] = useState<StatusState>({ statuses: null, error: false, pages: 0 });

  useEffect(() => {
    if (!fetchFn || !visibility) return undefined;
    const poller = createStatusPoller({
      fetch: fetchFn,
      visibility,
      onUpdate: (statuses) => setState((s) => ({ ...s, statuses, error: false })),
      onError: () => setState((s) => ({ ...s, error: true })),
      onProgress: (pages) => setState((s) => ({ ...s, pages })),
    });
    poller.start();
    return () => poller.stop();
  }, [fetchFn, visibility]);

  return state;
}
