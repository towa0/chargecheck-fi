export interface ScreenPoint {
  id: string;
  x: number;
  y: number;
}

export interface PinGroup {
  ids: string[];
  x: number;
  y: number;
}

/**
 * Greedy grouping of pins closer than `radius` pixels. Points are taken in order, so earlier
 * (better ranked) results seed groups. Ids in `alone` are never grouped, e.g. the selected pin.
 */
export function groupPoints(points: readonly ScreenPoint[], radius = 30, alone: ReadonlySet<string> = new Set()): PinGroup[] {
  const r2 = radius * radius;
  const used = new Set<string>();
  const groups: PinGroup[] = [];
  for (const p of points) {
    if (used.has(p.id)) continue;
    used.add(p.id);
    if (alone.has(p.id)) {
      groups.push({ ids: [p.id], x: p.x, y: p.y });
      continue;
    }
    const members = [p];
    for (const q of points) {
      if (used.has(q.id) || alone.has(q.id)) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      if (dx * dx + dy * dy < r2) {
        members.push(q);
        used.add(q.id);
      }
    }
    const x = members.reduce((s, m) => s + m.x, 0) / members.length;
    const y = members.reduce((s, m) => s + m.y, 0) / members.length;
    groups.push({ ids: members.map((m) => m.id), x, y });
  }
  return groups;
}

/** "€8" style short price for a pin. */
export function pinPrice(amount: number, currency = 'EUR'): string {
  const symbol = currency === 'EUR' ? '€' : `${currency} `;
  return `${symbol}${Math.round(amount)}`;
}
