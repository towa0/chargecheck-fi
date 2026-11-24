import { useI18n } from '../i18n/index.tsx';
import { statusLabel } from '../i18n/present.ts';
import { directionsUrl } from '../logic/best.ts';
import type { BestPick } from '../logic/best.ts';
import type { CheaperHint } from '../logic/hints.ts';
import { STANDARD_LABELS } from '../logic/format.ts';
import { NavigateIcon } from './Icons.tsx';

interface Props {
  pick: BestPick;
  energyKWh: number;
  hint: CheaperHint | null;
  onShow: (id: string) => void;
  onFix: ((fix: 'fast' | 'connector') => void) | null;
  /** Why there is no pick, for the copy. */
  noneKind: 'empty' | 'nofree' | 'noprice' | 'unavailable';
  filters: { fastOnly: boolean; connector: string };
}

export function BestCard({ pick, energyKWh, hint, onShow, onFix, noneKind, filters }: Props) {
  const { t, fmt } = useI18n();

  if (pick.kind === 'waiting') {
    return (
      <section className="hero hero-skeleton" aria-labelledby="best-heading" aria-busy="true">
        <h2 id="best-heading" className="hero-label">
          {t.hero.label}
        </h2>
        <span className="sk sk-hero-name" aria-hidden="true" />
        <span className="sk sk-hero-price" aria-hidden="true" />
        <span className="sk sk-hero-line" aria-hidden="true" />
        <p className="visually-hidden">
          {t.hero.loading}
        </p>
      </section>
    );
  }

  if (pick.kind === 'none') {
    const what = [filters.fastOnly ? t.hero.fastWord : '', filters.connector ? (STANDARD_LABELS[filters.connector] ?? filters.connector) : '']
      .filter(Boolean)
      .join(' ');
    const w = what ? `${what} ` : '';
    return (
      <section className="hero hero-none" aria-labelledby="best-heading">
        <h2 id="best-heading" className="hero-label">
          {t.hero.label}
        </h2>
        <p className="hero-none-text">{noneKind === 'unavailable' ? t.hero.unavailable : noneKind === 'empty' ? t.hero.noMatch(w) : noneKind === 'nofree' ? t.hero.noFree(w) : t.hero.noPrice}</p>
        {pick.fix && onFix && (
          <button type="button" className="btn" onClick={() => onFix(pick.fix ?? 'fast')}>
            {pick.fix === 'connector' ? t.hero.useAnyConnector : t.hero.turnOffFast}
          </button>
        )}
      </section>
    );
  }

  const { result, option } = pick;
  const { charger, distanceKm, availability } = result;
  const total = option.result.totalInclVat;
  const hours = option.powerKW > 0 ? energyKWh / option.powerKW : 0;
  return (
    <section className="hero" aria-labelledby="best-heading">
      <h2 id="best-heading" className="hero-label">
        {t.hero.label}
      </h2>
      <p className="hero-name">{charger.name}</p>
      <p className="hero-sub">
        <span className="num">{fmt.distance(distanceKm)}</span> · {charger.operator}
      </p>
      <p className="hero-price num">{result.cost.kind === 'estimate' ? fmt.priceRange(result.cost.min, result.cost.max, result.cost.currency) : fmt.money(total, option.result.currency)}</p>
      <p className="hero-meta num">
        <span className="hero-line">
          {statusLabel(t, availability, 'free')} · {fmt.power(option.powerKW)}
        </span>
        {hours > 0 && <span className="hero-line">{t.hero.chargeTime(fmt.duration(hours))}</span>}
      </p>
      {hint && (
        <p className="hero-hint num">
          {t.hero.cheaperFrom(fmt.money(hint.saving, hint.currency), hint.label.replace(' tomorrow', ` ${t.hero.tomorrow}`))}
        </p>
      )}
      <p className="visually-hidden">{t.card.disclaimer}</p>
      <div className="hero-actions">
        <a className="btn btn-hero" href={directionsUrl(charger.lat, charger.lon)} target="_blank" rel="noreferrer">
          <NavigateIcon /> {t.hero.action}
          <span className="visually-hidden">{t.card.directionsHint}</span>
        </a>
        <button type="button" className="btn btn-hero-quiet" onClick={() => onShow(charger.id)}>
          {t.hero.showInList}
          <span className="visually-hidden">: {charger.name}</span>
        </button>
      </div>
    </section>
  );
}
