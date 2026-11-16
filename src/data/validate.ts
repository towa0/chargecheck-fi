// Hand-written shape checks for the generated data files. Each returns a list of problems.

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isStr);
}

export function validateRegion(data: unknown, tariffIds?: Set<string>): string[] {
  const errors: string[] = [];
  if (!isObj(data)) return ['region file is not an object'];
  if (!isStr(data.region)) errors.push('region: missing name');
  if (!Array.isArray(data.chargers)) return [...errors, 'chargers: not an array'];
  const seen = new Set<string>();
  const seenEvses = new Set<string>();
  data.chargers.forEach((c: unknown, i) => {
    const at = `chargers[${i}]`;
    if (!isObj(c)) {
      errors.push(`${at}: not an object`);
      return;
    }
    for (const key of ['id', 'name', 'address', 'operator'] as const) {
      if (!isStr(c[key])) errors.push(`${at}.${key}: not a string`);
    }
    if (isStr(c.id)) {
      if (seen.has(c.id)) errors.push(`${at}.id: duplicate ${c.id}`);
      seen.add(c.id);
    }
    if (!isNum(c.lat) || c.lat < 59 || c.lat > 71) errors.push(`${at}.lat: outside Finland`);
    if (!isNum(c.lon) || c.lon < 19 || c.lon > 32) errors.push(`${at}.lon: outside Finland`);
    if (typeof c.open247 !== 'boolean') errors.push(`${at}.open247: not a boolean`);
    if (!Array.isArray(c.evses) || c.evses.length === 0) {
      errors.push(`${at}.evses: empty or not an array`);
      return;
    }
    c.evses.forEach((e: unknown, j) => {
      const eat = `${at}.evses[${j}]`;
      if (!isObj(e)) {
        errors.push(`${eat}: not an object`);
        return;
      }
      if (!isStr(e.id) || e.id === '') errors.push(`${eat}.id: missing`);
      else if (seenEvses.has(e.id)) errors.push(`${eat}.id: duplicate EVSE ${e.id}`);
      else seenEvses.add(e.id);
      if (e.kw !== null && (!isNum(e.kw) || e.kw <= 0)) errors.push(`${eat}.kw: not a positive number or null`);
      if (!isStrArray(e.standards)) errors.push(`${eat}.standards: not a string array`);
      if (!isStrArray(e.tariffIds)) errors.push(`${eat}.tariffIds: not a string array`);
      else if (tariffIds) {
        for (const id of e.tariffIds) if (!tariffIds.has(id)) errors.push(`${eat}.tariffIds: unknown tariff ${id}`);
      }
    });
  });
  return errors;
}

export function validateTariffs(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(data)) return ['tariffs file is not an object'];
  for (const [id, t] of Object.entries(data)) {
    if (!isObj(t)) {
      errors.push(`${id}: not an object`);
      continue;
    }
    if (t.id !== id) errors.push(`${id}: id does not match key`);
    if (!isStr(t.currency)) errors.push(`${id}: missing currency`);
    if (!Array.isArray(t.elements)) {
      errors.push(`${id}: elements not an array`);
      continue;
    }
    t.elements.forEach((el: unknown, i) => {
      if (!isObj(el) || !Array.isArray(el.priceComponents)) {
        errors.push(`${id}.elements[${i}]: no priceComponents`);
        return;
      }
      for (const pc of el.priceComponents as unknown[]) {
        if (!isObj(pc) || !isStr(pc.type) || !isNum(pc.price) || !isNum(pc.stepSize)) {
          errors.push(`${id}.elements[${i}]: bad price component`);
        }
      }
    });
  }
  return errors;
}

export function validateMeta(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(data)) return ['meta is not an object'];
  if (!isStr(data.builtAt) || Number.isNaN(Date.parse(data.builtAt))) errors.push('builtAt: not a date');
  for (const key of ['source', 'license', 'attribution'] as const) {
    if (!isStr(data[key])) errors.push(`${key}: not a string`);
  }
  if (!isObj(data.counts)) errors.push('counts: missing');
  if (!isObj(data.regions)) errors.push('regions: missing');
  return errors;
}
