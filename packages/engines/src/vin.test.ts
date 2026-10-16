import { describe, it, expect } from 'vitest';
import { decodeVin, computeCheckDigit, modelYearCandidates, looksLikeVin, type VinPattern } from './vin';

const patterns: VinPattern[] = [
  { id: 1, wmi: 'WVW', vdsRegex: '^ZZZAU', modelYearFrom: 2013, modelYearTo: 2020, generationId: 10, variantIds: [100, 101], priority: 1 },
  { id: 2, wmi: 'VF1', vdsRegex: '^R', modelYearFrom: 2012, modelYearTo: 2019, generationId: 20, variantIds: [200], priority: 1 },
];

describe('VIN decoder (ISO 3779)', () => {
  it('validates the classic North-American check digit example', () => {
    expect(computeCheckDigit('1M8GDM9AXKP042788')).toBe('X');
    const r = decodeVin('1M8GDM9AXKP042788');
    expect(r.checkDigit).toBe('valid');
    expect(r.region).toBe('north_america');
    expect(r.valid).toBe(true);
  });

  it('rejects a wrong NA check digit', () => {
    const r = decodeVin('1M8GDM9A1KP042788');
    expect(r.valid).toBe(false);
    expect(r.checkDigit).toBe('invalid');
  });

  it('rejects I, O, Q and wrong length', () => {
    expect(decodeVin('WVWZZZAUZFW00000I').valid).toBe(false);
    expect(decodeVin('WVWZZZAU').valid).toBe(false);
  });

  it('decodes a European VIN without check digit and matches patterns', () => {
    const r = decodeVin('wvw zzz au z fw 123456', patterns, 2026);
    expect(r.valid).toBe(true);
    expect(r.wmi).toBe('WVW');
    expect(r.region).toBe('europe');
    expect(r.checkDigit).toBe('not_applicable');
    expect(r.modelYearCandidates).toEqual([1985, 2015]);
    expect(r.matches.map(m => m.id)).toEqual([1]);
  });

  it('filters out patterns whose year range does not match', () => {
    const r = decodeVin('VF1RFB00X5Y123456', patterns, 2026); // pos10 = 5 → 2005 / 2035(future)
    expect(r.modelYearCandidates).toEqual([2005]);
    expect(r.matches).toEqual([]);
  });

  it('uses position 7 to pick the cycle in North America', () => {
    expect(modelYearCandidates('1M8GDM9AXKP042788')).toEqual([1989]);
  });

  it('detects VIN-like queries but not multi-word searches', () => {
    expect(looksLikeVin('WVWZZZAUZFW123456')).toBe(true);
    expect(looksLikeVin('golf 7 2.0 tdi')).toBe(false);
    expect(looksLikeVin('P0335')).toBe(false);
  });
});
