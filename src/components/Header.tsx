import { REGIONS } from '../data/regions.ts';
import { BoltIcon, LocateIcon } from './Icons.tsx';

interface Props {
  region: string;
  onRegion: (id: string) => void;
  onUseLocation: (() => void) | null;
  locating: boolean;
  usingLocation: boolean;
}

export function Header({ region, onRegion, onUseLocation, locating, usingLocation }: Props) {
  return (
    <header className="topbar">
      <a className="brand" href="./" aria-label="ChargeCheck Finland, home">
        <span className="brand-mark" aria-hidden="true">
          <BoltIcon width={16} height={16} />
        </span>
        <span className="brand-name">ChargeCheck</span>
      </a>
      <div className="topbar-actions">
        <fieldset className="segmented segmented-sm">
          <legend className="visually-hidden">Region</legend>
          {REGIONS.map((r) => (
            <label key={r.id} className="seg">
              <input type="radio" name="region" checked={region === r.id} onChange={() => onRegion(r.id)} />
              <span>{r.label}</span>
            </label>
          ))}
        </fieldset>
        {onUseLocation && (
          <button
            type="button"
            className={usingLocation ? 'btn btn-icon btn-on' : 'btn btn-icon'}
            onClick={onUseLocation}
            disabled={locating}
          >
            <LocateIcon width={18} height={18} />
            <span className="btn-icon-text">{locating ? 'Locating…' : 'Near me'}</span>
          </button>
        )}
      </div>
    </header>
  );
}
