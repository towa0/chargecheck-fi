import type { BestPick } from '../logic/best.ts';
import { powerBadge } from '../logic/best.ts';
import { formatDistance, formatMoney, formatPower } from '../logic/format.ts';
import { hintText, priceText, type CheaperHint } from './ResultCard.tsx';
import { StatusPill } from './StatusPill.tsx';

interface Props {
  pick: BestPick;
  energyKWh: number;
  startLabel: string;
  hint: CheaperHint | null;
  onShow: (id: string) => void;
  onFix: ((fix: 'fast' | 'connector') => void) | null;
  /** First load of live statuses, page by page. */
  progress?: { pages: number; expected: number } | null;
}

export function BestCard({ pick, energyKWh, startLabel, hint, onShow, onFix, progress = null }: Props) {
  if (pick.kind === 'waiting') {
    return (
      <section className="best best-waiting" aria-labelledby="best-heading">
        <h2 id="best-heading" className="best-label">
          Best right now
        </h2>
        <p className="muted">Checking which chargers are free…</p>
        {progress && (
          <div className="live-loading">
            <label htmlFor="status-progress">Loading live availability…</label>
            <progress id="status-progress" max={progress.expected} value={Math.min(progress.pages, progress.expected)}>
              {progress.pages} of {progress.expected} pages
            </progress>
          </div>
        )}
      </section>
    );
  }
  if (pick.kind === 'none') {
    return (
      <section className="best best-none" aria-labelledby="best-heading">
        <h2 id="best-heading" className="best-label">
          Best right now
        </h2>
        <p>{pick.reason}</p>
        {pick.fix && onFix && (
          <button type="button" className="btn" onClick={() => onFix(pick.fix ?? 'fast')}>
            {pick.fix === 'connector' ? 'Use any connector' : "Turn off 'Fast only'"}
          </button>
        )}
      </section>
    );
  }
  const { result, option } = pick;
  const { charger, distanceKm, availability, evses, cost } = result;
  const badge = powerBadge(evses);
  const start = startLabel === 'Now' ? 'starting now' : `starting ${startLabel.toLowerCase()}`;
  return (
    <section className="best" aria-labelledby="best-heading">
      <h2 id="best-heading" className="best-label">
        Best right now
      </h2>
      <div className="best-main">
        <div className="best-title">
          <p className="best-name">{charger.name}</p>
          <p className="card-sub">
            <span className="num">{formatDistance(distanceKm)}</span> · {charger.operator}
          </p>
        </div>
        <p className="best-price">
          <span className="num">{cost.kind === 'estimate' ? priceText(cost) : formatMoney(option.result.totalInclVat)}</span>
          <span className="price-label">estimated</span>
        </p>
      </div>
      <div className="card-meta">
        <StatusPill availability={availability} />
        {badge && <span className="badge num">{badge}</span>}
      </div>
      {hint && <p className="hint hint-strong">{hintText(hint)}</p>}
      <p className="best-assumed muted">
        {energyKWh} kWh at up to {formatPower(option.powerKW)}, {start}. Estimated from the published tariff.
      </p>
      <button type="button" className="btn btn-quiet best-more" onClick={() => onShow(charger.id)}>
        See details<span className="visually-hidden">: {charger.name}</span>
      </button>
    </section>
  );
}
