import { directionsUrl, powerBadge } from '../logic/best.ts';
import { formatDistance } from '../logic/format.ts';
import type { Result } from '../logic/results.ts';
import { CrossIcon, DirectionsIcon } from './Icons.tsx';
import { priceText } from './ResultCard.tsx';
import { StatusPill } from './StatusPill.tsx';

interface Props {
  result: Result;
  onShowInList: () => void;
  onClose: () => void;
}

/** Small card over the map on phones for the selected pin. */
export function BottomCard({ result, onShowInList, onClose }: Props) {
  const { charger, cost, availability, distanceKm, evses } = result;
  const badge = powerBadge(evses);
  return (
    <section className="sheet" aria-label={`Selected charger: ${charger.name}`}>
      <div className="sheet-top">
        <div className="card-title">
          <h2 className="sheet-name">{charger.name}</h2>
          <p className="card-sub">
            <span className="num">{formatDistance(distanceKm)}</span> · {charger.operator}
          </p>
        </div>
        {cost.kind === 'estimate' ? (
          <p className="price">
            <span className="price-value num">{priceText(cost)}</span>
            <span className="price-label">estimated</span>
          </p>
        ) : (
          <p className="price-none">{cost.kind === 'no-price' ? 'Price not in the open data' : "Can't estimate"}</p>
        )}
        <button type="button" className="btn btn-icon sheet-close" onClick={onClose}>
          <CrossIcon />
          <span className="visually-hidden">Close</span>
        </button>
      </div>
      <div className="card-meta">
        <StatusPill availability={availability} />
        {badge && <span className="badge num">{badge}</span>}
      </div>
      <div className="sheet-actions">
        <button type="button" className="btn" onClick={onShowInList}>
          Show in list
        </button>
        <a className="btn btn-quiet" href={directionsUrl(charger.lat, charger.lon)} target="_blank" rel="noreferrer">
          <DirectionsIcon /> Directions<span className="visually-hidden"> (Google Maps, opens in a new tab)</span>
        </a>
      </div>
    </section>
  );
}
