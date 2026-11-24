import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useI18n } from '../i18n/index.tsx';

export type SheetState = 'peek' | 'half' | 'full';

interface Props {
  state: SheetState;
  onState: (next: SheetState) => void;
  children: ReactNode;
}

const ORDER: SheetState[] = ['peek', 'half', 'full'];

/** Phone-only list sheet over the map: peek, half and full height. Drag the handle, or tap or use arrow keys. */
export function BottomSheet({ state, onState, children }: Props) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startH: number; parentH: number; peekH: number; lastY: number; lastT: number; v: number } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);

  const label = state === 'peek' ? t.sheet.half : state === 'half' ? t.sheet.full : t.sheet.peek;

  const cycle = () => onState(state === 'peek' ? 'half' : state === 'half' ? 'full' : 'peek');

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = ORDER.indexOf(state);
    if (e.key === 'ArrowUp' && i < 2) {
      e.preventDefault();
      onState(ORDER[i + 1] ?? state);
    } else if (e.key === 'ArrowDown' && i > 0) {
      e.preventDefault();
      onState(ORDER[i - 1] ?? state);
    }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    const el = root.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const peekH = parseFloat(getComputedStyle(el).getPropertyValue('--peek')) || 224;
    drag.current = { startY: e.clientY, startH: el.offsetHeight, parentH: parent.clientHeight, peekH, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.v = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    if (Math.abs(e.clientY - d.startY) < 4 && dragH === null) return;
    setDragH(Math.min(d.parentH, Math.max(d.peekH, d.startH + (d.startY - e.clientY))));
  }

  function onPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (dragH === null) return;
    // A fast flick wins over position.
    const h = Math.min(d.parentH, Math.max(d.peekH, dragH - d.v * 120));
    const stops: [SheetState, number][] = [
      ['peek', d.peekH],
      ['half', d.parentH * 0.5],
      ['full', d.parentH],
    ];
    const next = stops.reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a))[0];
    setDragH(null);
    onState(next);
    // The click that follows a drag must not also cycle the state.
    e.preventDefault();
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  const suppressClick = useRef(false);

  return (
    <div
      ref={root}
      className={`sheet sheet-${state}${dragH !== null ? ' sheet-dragging' : ''}`}
      style={dragH !== null ? { height: dragH } : undefined}
    >
      <button
        type="button"
        className="sheet-handle"
        aria-label={`${t.sheet.handle}: ${label}`}
        onClick={() => {
          if (!suppressClick.current) cycle();
        }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setDragH(null);
        }}
      >
        <span className="sheet-grip" aria-hidden="true" />
      </button>
      <div className="sheet-scroll">{children}</div>
    </div>
  );
}
