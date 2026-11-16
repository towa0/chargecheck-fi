import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { STANDARD_LABELS } from '../logic/format.ts';
import {
  ENERGY_MAX,
  ENERGY_MIN,
  ENERGY_PRESETS,
  parseEnergy,
  timeLabel,
  type Settings,
  type TimeMode,
} from '../logic/settings.ts';
import { toLocalInputValue } from '../tariff/time.ts';
import { ChevronIcon } from './Icons.tsx';

type PanelId = 'energy' | 'time' | 'connector';

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  now: number;
}

/** "Add [30 kWh] · [Now] · [Any connector] · [Fast only]", each chip opening native controls. */
export function ChargeBar({ settings, onChange, now }: Props) {
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

  const chip = (id: PanelId, label: string, a11y: string) => (
    <button
      type="button"
      className="chip"
      aria-expanded={open === id}
      aria-controls={`panel-${id}`}
      ref={(el) => {
        if (el) chips.current.set(id, el);
      }}
      onClick={() => setOpen(open === id ? null : id)}
    >
      <span className="visually-hidden">{a11y}:</span> <span className="chip-value">{label}</span>
      <ChevronIcon className="chip-chevron" width={14} height={14} />
    </button>
  );

  // A pointer click on a choice closes the panel; arrow keys only move the selection.
  const pick = (e: { detail: number }) => {
    if (e.detail > 0) close(false);
  };

  return (
    <div
      className="chargebar"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <p className="chargebar-line" id="chargebar-label">
        <span className="chargebar-word">Add</span>
        {chip('energy', `${formatKwh(settings.energyKWh)} kWh`, 'Energy')}
        <span className="dot" aria-hidden="true">·</span>
        {chip('time', timeLabel(settings, now), 'Start')}
        <span className="dot" aria-hidden="true">·</span>
        {chip('connector', settings.connector ? (STANDARD_LABELS[settings.connector] ?? settings.connector) : 'Any connector', 'Connector')}
        <span className="dot" aria-hidden="true">·</span>
        <label className="chip chip-toggle">
          <input type="checkbox" checked={settings.fastOnly} onChange={(e) => set({ fastOnly: e.target.checked })} />
          <span>
            Fast only<span className="visually-hidden"> (50 kW or more)</span>
          </span>
        </label>
      </p>

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
            <legend>Connector</legend>
            {[['', 'Any connector'] as const, ...Object.entries(STANDARD_LABELS)].map(([value, label]) => (
              <label key={value} className="choice">
                <input
                  type="radio"
                  name="connector"
                  value={value}
                  checked={settings.connector === value}
                  onChange={() => set({ connector: value })}
                  onClick={pick}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        </Panel>
      )}
    </div>
  );
}

function formatKwh(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Panel({ id, children, onDone }: { id: PanelId; children: ReactNode; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Move focus into the panel so keyboard users land on the first control.
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input:checked') ?? el?.querySelector<HTMLElement>('input, select, button');
    first?.focus();
  }, []);
  return (
    <div className="popover" id={`panel-${id}`} ref={ref}>
      {children}
      <button type="button" className="btn btn-quiet popover-done" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function EnergyPanel({ value, onChange, onPick }: { value: number; onChange: (n: number) => void; onPick: (e: { detail: number }) => void }) {
  const isPreset = (ENERGY_PRESETS as readonly number[]).includes(value);
  const [custom, setCustom] = useState(isPreset ? '' : String(value));
  const [customMode, setCustomMode] = useState(!isPreset);
  const inputId = useId();
  const errorId = useId();
  const valid = !customMode || parseEnergy(custom) !== null;
  return (
    <fieldset className="choices">
      <legend>Energy to add</legend>
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
            <span>{p} kWh</span>
          </label>
        ))}
        <label className="seg">
          <input type="radio" name="energy" checked={customMode} onChange={() => setCustomMode(true)} />
          <span>Custom</span>
        </label>
      </div>
      {customMode && (
        <div className="field">
          <label htmlFor={inputId}>Energy to add (kWh)</label>
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
              Enter a number from {ENERGY_MIN} to {ENERGY_MAX}.
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
  const inputId = useId();
  const modes: [TimeMode, string][] = [
    ['now', 'Now'],
    ['tonight', timeLabel({ timeMode: 'tonight', customStart: '' }, now)],
    ['custom', 'Custom'],
  ];
  return (
    <fieldset className="choices">
      <legend>Start charging</legend>
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
            <span>{label}</span>
          </label>
        ))}
      </div>
      {settings.timeMode === 'custom' && (
        <div className="field">
          <label htmlFor={inputId}>Start time (Finnish time)</label>
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
