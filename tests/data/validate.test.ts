import { describe, expect, it } from 'vitest';
import { validateMeta, validateRegion, validateTariffs } from '../../src/data/validate.ts';

const good = {
  region: 'oulu',
  chargers: [
    {
      id: 'FI*001/1',
      name: 'Test',
      address: 'Street 1, 90100 Oulu',
      lat: 65.01,
      lon: 25.47,
      operator: 'Op',
      open247: true,
      evses: [{ id: 'FI*001*E1', kw: 22, standards: ['IEC_62196_T2'], tariffIds: ['t1'] }],
    },
  ],
};

describe('validateRegion', () => {
  it('accepts a good file', () => {
    expect(validateRegion(good, new Set(['t1']))).toEqual([]);
  });

  it('reports bad fields', () => {
    const bad = structuredClone(good);
    const c = bad.chargers[0]!;
    (c as Record<string, unknown>).lat = 10;
    (c.evses[0] as Record<string, unknown>).kw = -1;
    c.evses[0]!.tariffIds = ['nope'];
    const errors = validateRegion(bad, new Set(['t1']));
    expect(errors.join('\n')).toMatch(/lat: outside Finland/);
    expect(errors.join('\n')).toMatch(/kw: not a positive number/);
    expect(errors.join('\n')).toMatch(/unknown tariff nope/);
  });

  it('reports duplicate charger and EVSE ids', () => {
    const dup = { ...good, chargers: [good.chargers[0], good.chargers[0]] };
    const errors = validateRegion(dup).join('\n');
    expect(errors).toMatch(/duplicate FI\*001\/1/);
    expect(errors).toMatch(/duplicate EVSE/);
  });

  it('rejects the wrong top-level shape', () => {
    expect(validateRegion([])).not.toEqual([]);
    expect(validateRegion({ region: 'x' })).toContain('chargers: not an array');
  });
});

describe('validateTariffs', () => {
  it('checks ids and components', () => {
    expect(validateTariffs({ a: { id: 'a', currency: 'EUR', elements: [{ priceComponents: [{ type: 'ENERGY', price: 1, stepSize: 1 }] }] } })).toEqual([]);
    expect(validateTariffs({ a: { id: 'b', currency: 'EUR', elements: [] } })).toContain('a: id does not match key');
    expect(validateTariffs({ a: { id: 'a', currency: 'EUR', elements: [{ priceComponents: [{ type: 'ENERGY' }] }] } })).toHaveLength(1);
  });
});

describe('validateMeta', () => {
  it('checks required fields', () => {
    expect(validateMeta({ builtAt: '2026-11-16T00:00:00Z', source: 's', license: 'l', attribution: 'a', counts: {}, regions: {} })).toEqual([]);
    expect(validateMeta({ builtAt: 'yesterday' }).length).toBeGreaterThan(3);
  });
});
