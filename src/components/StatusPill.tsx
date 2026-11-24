import type { Availability } from '../logic/results.ts';
import { availabilityKind } from '../logic/status.ts';
import { useI18n } from '../i18n/index.tsx';
import { statusLabel } from '../i18n/present.ts';

/** Status dot plus text label. Offline and unknown are both grey; the words tell them apart. */
export function StatusPill({ availability, loading = false }: { availability: Availability | null; loading?: boolean }) {
  const { t } = useI18n();
  if (loading) {
    return (
      <span className="status status-loading">
        <span className="sk sk-status" aria-hidden="true" />
        <span className="visually-hidden">{t.status.checking}</span>
      </span>
    );
  }
  const kind = availabilityKind(availability);
  return (
    <span className={`status status-${kind}`}>
      <span className="status-dot" aria-hidden="true" />
      {statusLabel(t, availability, kind)}
    </span>
  );
}
