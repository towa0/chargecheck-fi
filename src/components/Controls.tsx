import type { SortKey } from '../logic/results.ts';
import { REGIONS } from '../data/regions.ts';
import { STANDARD_LABELS } from '../logic/format.ts';

export interface ControlValues {
  energy: string;
  fastOnly: boolean;
  connector: string;
  start: string;
  region: string;
  sort: SortKey;
}

export const ENERGY_MIN = 1;
export const ENERGY_MAX = 200;

export function parseEnergy(value: string): number | null {
  const n = Number(value.replace(',', '.'));
  if (value.trim() === '' || !Number.isFinite(n) || n < ENERGY_MIN || n > ENERGY_MAX) return null;
  return n;
}

interface Props {
  values: ControlValues;
  onChange: (next: ControlValues) => void;
  startValid: boolean;
  locationLabel: string;
  locating: boolean;
  onUseLocation: (() => void) | null;
}

export function Controls({ values, onChange, startValid, locationLabel, locating, onUseLocation }: Props) {
  const set = <K extends keyof ControlValues>(key: K, value: ControlValues[K]) => onChange({ ...values, [key]: value });
  const energyValid = parseEnergy(values.energy) !== null;

  return (
    <form className="controls" onSubmit={(e) => e.preventDefault()} aria-label="Search options">
      <div className="field">
        <label htmlFor="energy">Energy to add (kWh)</label>
        <input
          id="energy"
          type="number"
          inputMode="decimal"
          min={ENERGY_MIN}
          max={ENERGY_MAX}
          step="any"
          value={values.energy}
          aria-invalid={!energyValid}
          aria-describedby={energyValid ? undefined : 'energy-error'}
          onChange={(e) => set('energy', e.target.value)}
        />
        {!energyValid && (
          <p id="energy-error" className="field-error">
            Enter a number from {ENERGY_MIN} to {ENERGY_MAX}.
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="start">Start time (Finnish time)</label>
        <input
          id="start"
          type="datetime-local"
          value={values.start}
          aria-invalid={!startValid}
          aria-describedby={startValid ? undefined : 'start-error'}
          onChange={(e) => set('start', e.target.value)}
        />
        {!startValid && (
          <p id="start-error" className="field-error">
            Enter a date and time.
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="connector">Connector</label>
        <select id="connector" value={values.connector} onChange={(e) => set('connector', e.target.value)}>
          <option value="">Any connector</option>
          {Object.entries(STANDARD_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="region">Region</label>
        <select id="region" value={values.region} onChange={(e) => set('region', e.target.value)}>
          {REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="sort">Sort by</label>
        <select id="sort" value={values.sort} onChange={(e) => set('sort', e.target.value as SortKey)}>
          <option value="cost">Estimated cost</option>
          <option value="distance">Distance</option>
          <option value="power">Power</option>
        </select>
      </div>

      <div className="field field-check">
        <input
          id="fast"
          type="checkbox"
          checked={values.fastOnly}
          onChange={(e) => set('fastOnly', e.target.checked)}
        />
        <label htmlFor="fast">Fast chargers only (50 kW or more)</label>
      </div>

      <div className="field field-location">
        <p className="location-label">{locationLabel}</p>
        {onUseLocation && (
          <button type="button" onClick={onUseLocation} disabled={locating}>
            {locating ? 'Finding your location…' : 'Use my location'}
          </button>
        )}
      </div>
    </form>
  );
}
