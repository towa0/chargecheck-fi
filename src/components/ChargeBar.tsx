import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { startLabel } from '../i18n/present.ts';
import { STANDARD_LABELS } from '../logic/format.ts';
import { ENERGY_MAX, ENERGY_MIN, ENERGY_PRESETS, parseEnergy, type Settings, type TimeMode } from '../logic/settings.ts';
import { toLocalInputValue } from '../tariff/time.ts';
import { BoltIcon, ChevronIcon, ConnectorIcon } from './Icons.tsx';

type PanelId = 'energy' | 'time' | 'connector';

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  now: number;
}

/** Compact filter bar: energy, start time, connector and fast-only. Scrolls sideways on narrow screens. */
export function ChargeBar({ settings, onChange, now }: Props) {
  const { t, fmt } = useI18n();
  const [open, setOpen] = useState<PanelId | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const chips = useRef(new Map<PanelId, HTMLButtonElement>());
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  const close = (focusChip = true) => {
    const was = open;
    setOpen(null);
    if (focusChip && was) chips.current.get(was)?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const chip = (id: PanelId, label: string, a11y: string, active: boolean) => (
    <button
      type="button"
      className={['chip', active ? 'chip-active' : '', open === id ? 'chip-open' : ''].filter(Boolean).join(' ')}
      aria-expanded={open === id}
      aria-controls={`panel-${id}`}
      ref={(el) => {
        if (el) chips.current.set(id, el);
      }}
      onClick={() => setOpen(open === id ? null : id)}
    >
      <span className="visually-hidden">{a11y}:</span> <span className="chip-value num">{label}</span>
      <ChevronIcon className="chip-chevron" width={14} height={14} />
    </button>
  );

  // A pointer click on a choice closes the panel; arrow keys only move the selection.
  const pick = (e: { detail: number }) => {
    if (e.detail > 0) close(false);
  };

  const connectorLabel = settings.connector ? (STANDARD_LABELS[settings.connector] ?? settings.connector) : t.filters.anyConnector;

  return (
    <div
      className="filterbar"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="filterbar-scroll" role="group" aria-label={t.filters.label}>
        {chip('energy', fmt.kwh(settings.energyKWh), t.filters.energy, false)}
        {chip('time', startLabel(t, fmt, settings, now), t.filters.start, settings.timeMode !== 'now')}
        {chip('connector', connectorLabel, t.filters.connector, settings.connector !== '')}
        <label className={settings.fastOnly ? 'chip chip-toggle chip-active' : 'chip chip-toggle'}>
          <input type="checkbox" checked={settings.fastOnly} onChange={(e) => set({ fastOnly: e.target.checked })} />
          <BoltIcon width={13} height={13} />
          <span>
            {t.filters.fastOnly}
            <span className="visually-hidden">{t.filters.fastOnlyHint}</span>
          </span>
        </label>
      </div>

      {open === 'energy' && (
        <Panel id="energy" onDone={() => close()}>
          <EnergyPanel value={settings.energyKWh} onChange={(energyKWh) => set({ energyKWh })} onPick={pick} />
        </Panel>
      )}
      {open === 'time' && (
        <Panel id="time" onDone={() => close()}>
          <TimePanel settings={settings} now={now} onChange={set} onPick={pick} />
        </Panel>
      )}
      {open === 'connector' && (
        <Panel id="connector" onDone={() => close()}>
          <fieldset className="choices">
            <legend>{t.filters.connector}</legend>
            <div className="connector-choices">
              {[['', t.filters.anyConnector] as const, ...Object.entries(STANDARD_LABELS)].map(([value, label]) => (
                <label key={value} className="choice">
                  <input
                    type="radio"
                    name="connector"
                    value={value}
                    checked={settings.connector === value}
                    onChange={() => set({ connector: value })}
                    onClick={pick}
                  />
                  <span>
                    {value && <ConnectorIcon standard={value} />}
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </Panel>
      )}
    </div>
  );
}

function Panel({ id, children, onDone }: { id: PanelId; children: ReactNode; onDone: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Move focus into the panel so keyboard users land on the first control.
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input:checked') ?? el?.querySelector<HTMLElement>('input, select, button');
    first?.focus();
  }, []);
  return (
    <div className="panel" id={`panel-${id}`} ref={ref}>
      {children}
      <button type="button" className="btn btn-quiet panel-done" onClick={onDone}>
        {t.filters.done}
      </button>
    </div>
  );
}

function EnergyPanel({ value, onChange, onPick }: { value: number; onChange: (n: number) => void; onPick: (e: { detail: number }) => void }) {
  const { t, fmt } = useI18n();
  const isPreset = (ENERGY_PRESETS as readonly number[]).includes(value);
  const [custom, setCustom] = useState(isPreset ? '' : String(value));
  const [customMode, setCustomMode] = useState(!isPreset);
  const inputId = useId();
  const errorId = useId();
  const valid = !customMode || parseEnergy(custom) !== null;
  return (
    <fieldset className="choices">
      <legend>{t.filters.energyToAdd}</legend>
      <div className="segmented">
        {ENERGY_PRESETS.map((p) => (
          <label key={p} className="seg">
            <input
              type="radio"
              name="energy"
              checked={!customMode && value === p}
              onChange={() => {
                setCustomMode(false);
                onChange(p);
              }}
              onClick={onPick}
            />
            <span className="num">{fmt.kwh(p)}</span>
          </label>
        ))}
        <label className="seg">
          <input type="radio" name="energy" checked={customMode} onChange={() => setCustomMode(true)} />
          <span>{t.filters.custom}</span>
        </label>
      </div>
      {customMode && (
        <div className="field">
          <label htmlFor={inputId}>{t.filters.customEnergy}</label>
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            min={ENERGY_MIN}
            max={ENERGY_MAX}
            step="any"
            value={custom}
            aria-invalid={!valid}
            aria-describedby={valid ? undefined : errorId}
            onChange={(e) => {
              setCustom(e.target.value);
              const n = parseEnergy(e.target.value);
              if (n !== null) onChange(n);
            }}
          />
          {!valid && (
            <p id={errorId} className="field-error">
              {t.filters.energyError(ENERGY_MIN, ENERGY_MAX)}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

function TimePanel({
  settings,
  now,
  onChange,
  onPick,
}: {
  settings: Settings;
  now: number;
  onChange: (p: Partial<Settings>) => void;
  onPick: (e: { detail: number }) => void;
}) {
  const { t, fmt } = useI18n();
  const inputId = useId();
  const modes: [TimeMode, string][] = [
    ['now', t.filters.now],
    ['tonight', startLabel(t, fmt, { timeMode: 'tonight', customStart: '' }, now)],
    ['custom', t.filters.custom],
  ];
  return (
    <fieldset className="choices">
      <legend>{t.filters.startCharging}</legend>
      <div className="segmented">
        {modes.map(([mode, label]) => (
          <label key={mode} className="seg">
            <input
              type="radio"
              name="time"
              checked={settings.timeMode === mode}
              onChange={() =>
                onChange(
                  mode === 'custom'
                    ? { timeMode: mode, customStart: settings.customStart || toLocalInputValue(new Date(now)) }
                    : { timeMode: mode },
                )
              }
              onClick={mode === 'custom' ? undefined : onPick}
            />
            <span className="num">{label}</span>
          </label>
        ))}
      </div>
      {settings.timeMode === 'custom' && (
        <div className="field">
          <label htmlFor={inputId}>{t.filters.startTime}</label>
          <input
            id={inputId}
            type="datetime-local"
            value={settings.customStart}
            onChange={(e) => e.target.value && onChange({ customStart: e.target.value })}
          />
        </div>
      )}
    </fieldset>
  );
}
