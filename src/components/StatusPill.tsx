import type { Availability } from '../logic/results.ts';
import { availabilityKind, availabilityText } from '../logic/status.ts';
import { StatusIcon } from './Icons.tsx';

/** Availability as shape + icon + text, so it never relies on colour. */
export function StatusPill({ availability, loading = false }: { availability: Availability | null; loading?: boolean }) {
  if (loading) {
    return <span className="pill pill-loading">Checking…</span>;
  }
  const kind = availabilityKind(availability);
  return (
    <span className={`pill pill-${kind}`}>
      <span className={`shape shape-${kind}`} aria-hidden="true">
        <StatusIcon kind={kind} width={12} height={12} />
      </span>
      {availabilityText(availability, kind)}
    </span>
  );
}
