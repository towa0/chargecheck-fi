import { forwardRef } from 'react';
import type { Availability, ChargerCost, Result } from '../logic/results.ts';
import {
  LINE_LABELS,
  formatAge,
  formatDistance,
  formatMoney,
  formatPower,
  formatQuantity,
  formatUnit,
  isStale,
  standardLabel,
  tariffTypeLabel,
} from '../logic/format.ts';

const STATUS_LABELS: Record<string, string> = {
  CHARGING: 'in use',
  BLOCKED: 'blocked',
  OUTOFORDER: 'out of order',
  INOPERATIVE: 'not working',
  RESERVED: 'reserved',
  PLANNED: 'not open yet',
  REMOVED: 'removed',
  UNKNOWN: 'status unknown',
};

interface Props {
  result: Result;
  now: number;
  selected: boolean;
  onShowOnMap: (() => void) | null;
}

export function AvailabilityLine({ availability, now }: { availability: Availability | null; now: number }) {
  if (!availability) return <p className="availability muted">Checking live status…</p>;
  const { available, total, unknown, oldestUpdate } = availability;
  const others = [...availability.byStatus.entries()]
    .filter(([s]) => s !== 'AVAILABLE')
    .map(([s, n]) => `${n} ${STATUS_LABELS[s] ?? s.toLowerCase()}`);
  if (unknown > 0) others.push(`${unknown} with no live status`);
  const stale = oldestUpdate !== null && isStale(oldestUpdate, now);
  return (
    <p className="availability">
      <span className={available > 0 ? 'avail avail-yes' : 'avail avail-no'}>
        {available} of {total} available
      </span>
      {others.length > 0 && <span className="muted"> ({others.join(', ')})</span>}
      {oldestUpdate && (
        <>
          <span className="muted"> · {formatAge(oldestUpdate, now)}</span>
          {stale && <strong className="stale"> · status may be outdated</strong>}
        </>
      )}
    </p>
  );
}

function CostSummary({ cost }: { cost: ChargerCost }) {
  if (cost.kind === 'no-price') return <p className="cost cost-none">Price not in the open data</p>;
  if (cost.kind === 'refused') return <p className="cost cost-none">Can't estimate: {cost.reason}</p>;
  const same = Math.abs(cost.max - cost.min) < 0.005;
  return (
    <p className="cost">
      <span className="cost-label">Estimated cost </span>
      <strong className="cost-value">
        {same ? formatMoney(cost.min, cost.currency) : `${formatMoney(cost.min, cost.currency)} to ${formatMoney(cost.max, cost.currency)}`}
      </strong>
    </p>
  );
}

function Breakdown({ cost }: { cost: Extract<ChargerCost, { kind: 'estimate' }> }) {
  const many = cost.options.length > 1;
  return (
    <details className="breakdown">
      <summary>Cost breakdown</summary>
      {many && <p>This charger lists {cost.options.length} prices for your session. Each one is below.</p>}
      {cost.options.map((o, i) => {
        const type = tariffTypeLabel(o.tariffType);
        return (
          <div key={`${o.tariffId}|${o.powerKW}`} className="breakdown-option">
            <h4>
              {many ? `Price ${i + 1}: ` : ''}
              {formatMoney(o.result.totalInclVat, o.result.currency)} at {formatPower(o.powerKW)}
              {type ? `, ${type}` : ''}
            </h4>
            <table>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Amount × price incl. VAT</th>
                    <th scope="col" className="num">Cost</th>
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
        <p>
          {cost.refused.length === 1 ? 'One more price here' : `${cost.refused.length} more prices here`} can't be
          estimated: {[...new Set(cost.refused.map((r) => r.result.reason))].join(' ')}
        </p>
      )}
      {cost.someWithoutPrice && <p>Some connectors here have no price in the open data.</p>}
    </details>
  );
}

export const ResultItem = forwardRef<HTMLElement, Props>(function ResultItem(
  { result, now, selected, onShowOnMap },
  ref,
) {
  const { charger, evses, distanceKm, maxKw, availability, cost } = result;
  const standards = [...new Set(evses.flatMap((e) => e.standards))].map(standardLabel);
  const headingId = `charger-${charger.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return (
    <article
      ref={ref}
      tabIndex={-1}
      className={selected ? 'result result-selected' : 'result'}
      aria-labelledby={headingId}
      data-charger-id={charger.id}
    >
      <h3 id={headingId}>{charger.name}</h3>
      <p className="muted">
        {charger.operator}
        {charger.address ? ` · ${charger.address}` : ''}
      </p>
      <p className="facts">
        <span>{formatDistance(distanceKm)} away</span>
        <span>Up to {formatPower(maxKw)}</span>
        {standards.length > 0 && <span>{standards.join(', ')}</span>}
        {charger.open247 && <span>Open 24/7</span>}
      </p>
      <AvailabilityLine availability={availability} now={now} />
      <CostSummary cost={cost} />
      {cost.kind === 'estimate' && <Breakdown cost={cost} />}
      {onShowOnMap && (
        <button type="button" className="link-button" onClick={onShowOnMap}>
          Show on map<span className="visually-hidden">: {charger.name}</span>
        </button>
      )}
    </article>
  );
});
