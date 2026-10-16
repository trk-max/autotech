import { describe, it, expect } from 'vitest';
import { computeQuote, validateStepGraph, formatTnd, laborPriceMillimes, type LaborStep, type LaborOperation } from './labor';

const S = (id: number, code: string, hours: number, isAccess: boolean, requires: number[] = []): LaborStep =>
  ({ id, code, name: code, hours, isAccess, requires });
const steps = new Map<number, LaborStep>([
  [1, S(1, 'ENGINE_COVER', 0.1, true)],
  [2, S(2, 'ACC_BELT', 0.3, true, [1])],
  [3, S(3, 'ENGINE_SUPPORT', 0.6, true, [2])],
  [4, S(4, 'TIMING_COVERS', 0.4, true, [3])],
  [5, S(5, 'TIMING_BELT_RR', 1.0, true, [4])],
  [6, S(6, 'WATER_PUMP', 0.4, false, [5])],
  [7, S(7, 'TENSIONER_IDLERS', 0.4, false, [5])],
  [8, S(8, 'BRAKE_PADS_FRONT', 0.8, false)],
]);
const WP: LaborOperation = { id: 1, code: 'WP', name: 'Pompe à eau', oemHours: 2.8, stepIds: [6] };
const TB: LaborOperation = { id: 2, code: 'TB', name: 'Kit distribution', oemHours: 2.8, stepIds: [7] };
const BR: LaborOperation = { id: 3, code: 'BR', name: 'Plaquettes AV', oemHours: 0.8, stepIds: [8] };

describe('overlap labor engine', () => {
  it('single op equals OEM time', () => {
    expect(computeQuote([WP], steps).netHours).toBe(2.8);
  });

  it('water pump + timing belt shares the teardown', () => {
    const q = computeQuote([WP, TB], steps);
    expect(q.method).toBe('dag');
    expect(q.grossHours).toBe(5.6);
    expect(q.netHours).toBe(3.2);
    expect(q.savedHours).toBe(2.4);
    expect(q.lines.find(l => l.code === 'TIMING_BELT_RR')!.sharedBy).toEqual(['WP', 'TB']);
  });

  it('unrelated jobs do not overlap', () => {
    const q = computeQuote([WP, BR], steps);
    expect(q.netHours).toBe(3.6);
    expect(q.savedHours).toBe(0);
  });

  it('net never exceeds gross and duplicates are ignored', () => {
    const q = computeQuote([WP, TB, BR, WP], steps);
    expect(q.netHours).toBeLessThanOrEqual(q.grossHours);
    expect(q.operations).toHaveLength(3);
    expect(q.warnings.length).toBeGreaterThan(0);
  });

  it('OEM pair rule overrides the DAG', () => {
    const q = computeQuote([TB, WP], steps, [{ opA: 1, opB: 2, deductHours: 2.2 }]);
    expect(q.method).toBe('oem_rules');
    expect(q.netHours).toBe(3.4);
  });

  it('detects cycles and missing steps', () => {
    const cyc = new Map(steps);
    cyc.set(1, S(1, 'ENGINE_COVER', 0.1, true, [6]));
    expect(() => validateStepGraph(cyc)).toThrow(/Cycle/);
    expect(() => validateStepGraph(steps)).not.toThrow();
    expect(() => computeQuote([{ ...WP, stepIds: [42] }], steps)).toThrow();
  });

  it('formats Tunisian dinars with millimes', () => {
    expect(laborPriceMillimes(3.2, 45000)).toBe(144000);
    expect(formatTnd(144000)).toBe('144,000 DT');
    expect(formatTnd(1234567)).toBe('1 234,567 DT');
  });
});
