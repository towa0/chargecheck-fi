import { forwardRef, useId } from 'react';
import { directionsUrl, geoUrl, powerBadge } from '../logic/best.ts';
import {
  LINE_LABELS,
  formatDistance,
  formatMoney,
  formatPower,
  formatQuantity,
  formatUnit,
  standardLabel,
  tariffTypeLabel,
} from '../logic/format.ts';
import type { ChargerCost, Result } from '../logic/results.ts';
import { freshness, statusSummary } from '../logic/status.ts';
import { ChevronIcon, DirectionsIcon } from './Icons.tsx';
import { StatusPill } from './StatusPill.tsx';

export interface CheaperHint {
  saving: number;
  label: string;
  currency: string;
}

interface Props {
  result: Result;
  now: number;
  statusesLoaded: boolean;
  selected: boolean;
  highlighted: boolean;
  expanded: boolean;
  hint: CheaperHint | null;
  onToggle: () => void;
  onHighlight: (id: string | null) => void;
}

export function priceText(cost: Extract<ChargerCost, { kind: 'estimate' }>): string {
  const same = Math.abs(cost.max - cost.min) < 0.005;
  return same ? formatMoney(cost.min, cost.currency) : `${formatMoney(cost.min, cost.currency)}–${formatMoney(cost.max, cost.currency)}`;
}

export function hintText(h: CheaperHint): string {
  return `${formatMoney(h.saving, h.currency)} cheaper from ${h.label}`;
}

function Price({ cost }: { cost: ChargerCost }) {
  if (cost.kind === 'no-price') return <p className="price-none">Price not in the open data</p>;
  if (cost.kind === 'refused') return <p className="price-none">Can't estimate</p>;
  return (
    <p className="price">
      <span className="price-value num">{priceText(cost)}</span>
      <span className="price-label">estimated</span>
    </p>
  );
}

export function Breakdown({ cost }: { cost: Extract<ChargerCost, { kind: 'estimate' }> }) {
  const many = cost.options.length > 1;
  return (
    <div className="breakdown">
      <h4 className="details-title">Cost breakdown</h4>
      {cost.options.map((o, i) => {
        const type = tariffTypeLabel(o.tariffType);
        return (
          <div key={`${o.tariffId}|${o.powerKW}`} className="breakdown-option">
            <p className="breakdown-head">
              {many ? `Price ${i + 1}: ` : ''}
              <strong className="num">{formatMoney(o.result.totalInclVat, o.result.currency)}</strong> at{' '}
              {formatPower(o.powerKW)}
              {type ? `, ${type}` : ''}
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Amount × price incl. VAT</th>
                  <th scope="col" className="num">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {o.result.breakdown.map((line, j) => (
                  <tr key={j}>
                    <th scope="row">{LINE_LABELS[line.type]}</th>
                    <td>
                      {formatQuantity(line)} × {formatUnit(line, o.result.currency)}
                      {line.vat !== null ? ` (VAT ${line.vat}%)` : ''}
                    </td>
                    <td className="num">{formatMoney(line.amount, o.result.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="assumptions">
              {o.result.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        );
      })}
      {cost.refused.length > 0 && (
        <p className="muted">
          {cost.refused.length === 1 ? 'One more price here' : `${cost.refused.length} more prices here`} can't be
          estimated: {[...new Set(cost.refused.map((r) => r.result.reason))].join(' ')}
        </p>
      )}
      {cost.someWithoutPrice && <p className="muted">Some connectors here have no price in the open data.</p>}
      <p className="muted">Estimated from the published tariff. Prices in apps or via roaming can differ.</p>
    </div>
  );
}

export function Freshness({ result, now }: { result: Result; now: number }) {
  const f = freshness(result.availability, now);
  if (!f) return null;
  return (
    <span className={f.stale ? 'fresh fresh-stale' : 'fresh'}>
      {f.text}
      {f.stale && <strong> · may be outdated</strong>}
    </span>
  );
}

export const ResultCard = forwardRef<HTMLElement, Props>(function ResultCard(
  { result, now, statusesLoaded, selected, highlighted, expanded, hint, onToggle, onHighlight },
  ref,
) {
  const { charger, evses, distanceKm, cost, availability } = result;
  const standards = [...new Set(evses.flatMap((e) => e.standards))].map(standardLabel);
  const badge = powerBadge(evses);
  const uid = useId();
  const headingId = `${uid}-name`;
  const detailsId = `${uid}-details`;
  const id = charger.id;
  return (
    <article
      ref={ref}
      tabIndex={-1}
      className={['card', selected ? 'card-selected' : '', highlighted ? 'card-highlight' : ''].join(' ')}
      aria-labelledby={headingId}
      data-charger-id={id}
      onMouseEnter={() => onHighlight(id)}
      onMouseLeave={() => onHighlight(null)}
      onFocus={() => onHighlight(id)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHighlight(null);
      }}
    >
      <div className="card-body">
        <div className="card-top">
          <div className="card-title">
            <h3 id={headingId}>{charger.name}</h3>
            <p className="card-sub">
              <span className="num">{formatDistance(distanceKm)}</span> · {charger.operator}
            </p>
          </div>
          <Price cost={cost} />
        </div>
        <div className="card-meta">
          <StatusPill availability={availability} loading={!statusesLoaded} />
          {badge && <span className="badge num">{badge}</span>}
          {standards.length > 0 && <span className="connectors">{standards.join(', ')}</span>}
        </div>
        {cost.kind === 'refused' && <p className="quiet">Can't estimate: {cost.reason}</p>}
        {hint && <p className="hint">{hintText(hint)}</p>}
        {statusesLoaded && <Freshness result={result} now={now} />}
      </div>
      <button type="button" className="card-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={onToggle}>
        Details
        <span className="visually-hidden">: {charger.name}</span>
        <ChevronIcon className="toggle-chevron" />
      </button>
      <div id={detailsId} className="card-details" hidden={!expanded}>
        {expanded && (
          <>
            {cost.kind === 'estimate' && cost.options.length > 1 && (
              <details className="why">
                <summary>Why a range?</summary>
                <p>
                  This charger lists {cost.options.length} prices for your session, for example for different
                  connectors, charging speeds or ways to pay. Each one is in the breakdown below.
                </p>
              </details>
            )}
            {cost.kind === 'estimate' && <Breakdown cost={cost} />}
            <div className="place">
              <h4 className="details-title">Place</h4>
              {statusSummary(availability) && <p>Charge points: {statusSummary(availability)}</p>}
              <p>{charger.address || 'Address not in the open data'}</p>
              <p className="muted">{charger.open247 ? 'Open 24/7' : 'Opening hours not in the open data'}</p>
              <p className="links">
                <a className="link" href={directionsUrl(charger.lat, charger.lon)} target="_blank" rel="noreferrer">
                  <DirectionsIcon /> Directions<span className="visually-hidden"> (Google Maps, opens in a new tab)</span>
                </a>
                <a className="link" href={geoUrl(charger.lat, charger.lon, charger.name)}>
                  Open in maps app
                </a>
              </p>
            </div>
          </>
        )}
      </div>
    </article>
  );
});
