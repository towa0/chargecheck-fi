import { forwardRef, useId, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { lineQuantity, lineUnit, type Fmt } from '../i18n/format.ts';
import { freshnessText, powerBadgeText, statusSummaryText, tariffTypeText } from '../i18n/present.ts';
import { directionsUrl, geoUrl } from '../logic/best.ts';
import type { CheaperHint } from '../logic/hints.ts';
import { standardLabel } from '../logic/format.ts';
import type { ChargerCost, Result } from '../logic/results.ts';
import { ChevronIcon, ConnectorIcon, DirectionsIcon } from './Icons.tsx';
import { StatusPill } from './StatusPill.tsx';

export type { CheaperHint };

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

type Estimate = Extract<ChargerCost, { kind: 'estimate' }>;

export function priceText(fmt: Fmt, cost: Estimate): string {
  return fmt.priceRange(cost.min, cost.max, cost.currency);
}

function Price({ cost }: { cost: ChargerCost }) {
  const { t, fmt } = useI18n();
  if (cost.kind === 'no-price') return <p className="row-price row-price-none">{t.card.noPrice}</p>;
  if (cost.kind === 'refused') return <p className="row-price row-price-none">{t.card.cantEstimate}</p>;
  return (
    <p className="row-price">
      <span className="row-price-value num">{priceText(fmt, cost)}</span>
      <span className="row-price-label">{t.card.estimated}</span>
    </p>
  );
}

export function Breakdown({ cost }: { cost: Estimate }) {
  const { t, fmt } = useI18n();
  const many = cost.options.length > 1;
  return (
    <div className="breakdown">
      <h4 className="details-title">{t.card.breakdown}</h4>
      {cost.options.map((o, i) => {
        const type = tariffTypeText(t, o.tariffType);
        return (
          <div key={`${o.tariffId}|${o.powerKW}`} className="breakdown-option">
            <p className="breakdown-head">
              {many ? `${t.card.priceN(i + 1)}: ` : ''}
              <strong className="num">{fmt.moneyExact(o.result.totalInclVat, o.result.currency)}</strong> {t.card.at}{' '}
              <span className="num">{fmt.power(o.powerKW)}</span>
              {type ? `, ${type}` : ''}
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.card.item}</th>
                  <th scope="col">{t.card.amountPrice}</th>
                  <th scope="col" className="num">
                    {t.card.cost}
                  </th>
                </tr>
              </thead>
              <tbody>
                {o.result.breakdown.map((line, j) => (
                  <tr key={j}>
                    <th scope="row">{t.lines[line.type]}</th>
                    <td className="num">
                      {lineQuantity(fmt, line)} × {lineUnit(fmt, t, line, o.result.currency)}
                      {line.vat !== null ? ` (${t.card.vat(line.vat)})` : ''}
                    </td>
                    <td className="num">{fmt.moneyExact(line.amount, o.result.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="assumptions">
              {o.result.assumptions.map((a) => (
                <li key={a} lang="en">
                  {a}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {cost.refused.length > 0 && (
        <p className="muted">
          {t.card.moreRefused(cost.refused.length)} {fmt.lang === 'fi' ? 'ei voi arvioida' : "can't be estimated"}:{' '}
          <span lang="en">{[...new Set(cost.refused.map((r) => r.result.reason))].join(' ')}</span>
        </p>
      )}
      {cost.someWithoutPrice && <p className="muted">{t.card.someNoPrice}</p>}
      <p className="muted">{t.card.disclaimer}</p>
    </div>
  );
}

export function Freshness({ result, now }: { result: Result; now: number }) {
  const { t } = useI18n();
  const f = freshnessText(t, result.availability, now);
  if (!f) return null;
  return (
    <span className={f.stale ? 'fresh fresh-stale' : 'fresh'}>
      {f.text}
      {f.stale && <strong> · {t.card.outdated}</strong>}
    </span>
  );
}

export const ResultCard = forwardRef<HTMLElement, Props>(function ResultCard(
  { result, now, statusesLoaded, selected, highlighted, expanded, hint, onToggle, onHighlight },
  ref,
) {
  const { t, fmt } = useI18n();
  const { charger, evses, distanceKm, cost, availability } = result;
  const standards = [...new Set(evses.flatMap((e) => e.standards))];
  const badge = powerBadgeText(t, fmt, evses);
  const uid = useId();
  const headingId = `${uid}-name`;
  const detailsId = `${uid}-details`;
  const id = charger.id;
  // Keep the details mounted after the first open so closing can animate.
  const [everOpened, setEverOpened] = useState(expanded);
  if (expanded && !everOpened) setEverOpened(true);
  const summary = statusSummaryText(t, availability);
  const stale = statusesLoaded && Boolean(freshnessText(t, availability, now)?.stale);
  return (
    <article
      ref={ref}
      tabIndex={-1}
      className={['row', selected ? 'row-selected' : '', highlighted ? 'row-highlight' : ''].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
      data-charger-id={id}
      onMouseEnter={() => onHighlight(id)}
      onMouseLeave={() => onHighlight(null)}
      onFocus={() => onHighlight(id)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHighlight(null);
      }}
    >
      <div className="row-top">
        <div className="row-title">
          <h3 id={headingId}>{charger.name}</h3>
          <p className="row-sub">
            {charger.operator} · <span className="num">{fmt.distance(distanceKm)}</span>
          </p>
        </div>
        <Price cost={cost} />
      </div>
      <div className="row-meta">
        <StatusPill availability={availability} loading={!statusesLoaded} />
        {statusesLoaded && stale && <span className="fresh fresh-stale">{t.card.outdated}</span>}
        {badge && <span className={badge.dc ? 'badge badge-dc num' : 'badge num'}>{badge.text}</span>}
        {standards.map((s) => (
          <span key={s} className="conn">
            <ConnectorIcon standard={s} />
            {standardLabel(s)}
          </span>
        ))}
      </div>
      {cost.kind === 'refused' && <p className="row-note">{t.card.cantEstimateWhy(cost.reason)}</p>}
      {hint && (
        <p className="row-hint num">
          {t.hero.cheaperFrom(fmt.money(hint.saving, hint.currency), hint.label.replace(' tomorrow', ` ${t.hero.tomorrow}`))}
          <span className="visually-hidden">. {t.card.disclaimer}</span>
        </p>
      )}
      <button type="button" className="row-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={onToggle}>
        {t.card.details}
        <span className="visually-hidden">: {charger.name}</span>
        <ChevronIcon className="toggle-chevron" />
      </button>
      <div id={detailsId} className="row-details" data-open={expanded} inert={!expanded}>
        <div className="row-details-inner">
          {everOpened && (
            <>
              {cost.kind === 'estimate' && cost.options.length > 1 && (
                <details className="why">
                  <summary>{t.card.whyRange}</summary>
                  <p>{t.card.whyRangeBody(cost.options.length)}</p>
                </details>
              )}
              {cost.kind === 'estimate' && <Breakdown cost={cost} />}
              <div className="place">
                {summary && (
                  <p>
                    {t.card.chargePoints}: {summary}
                  </p>
                )}
                {statusesLoaded && <Freshness result={result} now={now} />}
                <p>{charger.address || t.card.noAddress}</p>
                <p className="muted">{charger.open247 ? t.card.open247 : t.card.noHours}</p>
                <p className="links">
                  <a className="link" href={directionsUrl(charger.lat, charger.lon)} target="_blank" rel="noreferrer">
                    <DirectionsIcon /> {t.card.directions}
                    <span className="visually-hidden">{t.card.directionsHint}</span>
                  </a>
                  <a className="link" href={geoUrl(charger.lat, charger.lon, charger.name)}>
                    {t.card.openInMaps}
                  </a>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
});
