import { REGIONS } from '../data/regions.ts';
import { useI18n, type Lang } from '../i18n/index.tsx';
import { LocateIcon } from './Icons.tsx';

interface Props {
  region: string;
  onRegion: (id: string) => void;
  onUseLocation: (() => void) | null;
  locating: boolean;
  usingLocation: boolean;
  onLang: (lang: Lang) => void;
}

export function Header({ region, onRegion, onUseLocation, locating, usingLocation, onLang }: Props) {
  const { t, lang } = useI18n();
  return (
    <header className="topbar">
      <a className="wordmark" href="./" aria-label={t.nav.home}>
        ChargeCheck
      </a>
      <div className="topbar-actions">
        <div className="select-wrap">
          <label className="visually-hidden" htmlFor="region">
            {t.nav.region}
          </label>
          <select id="region" className="select" value={region} onChange={(e) => onRegion(e.target.value)}>
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {t.regions[r.id] ?? r.label}
              </option>
            ))}
          </select>
        </div>
        {onUseLocation && (
          <button
            type="button"
            className={usingLocation ? 'btn btn-near btn-on' : 'btn btn-near'}
            onClick={onUseLocation}
            disabled={locating}
            aria-pressed={usingLocation}
          >
            <LocateIcon width={18} height={18} />
            <span className="btn-text">{locating ? t.nav.locating : t.nav.nearMe}</span>
          </button>
        )}
        <div className="lang" role="group" aria-label={t.nav.language}>
          {(['fi', 'en'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} lang={l} onClick={() => onLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
