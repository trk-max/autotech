import { describe, it, expect } from 'vitest';
import {
  startSession, applyTestResult, rankTests, confirmedCause, evaluateMeasurement, inferTopologyCauses,
  updatedPrior, type DtcInput, type CauseCandidate, type TopologyInput, type TestRef,
} from './diag';

// ECM=1, TCM=2, ABS=3, Cluster=4 ; bus 10 = powertrain CAN ; ground node 900 shared by ECM+TCM
const topo: TopologyInput = {
  ecuBuses: { 1: [10], 2: [10], 3: [10, 11], 4: [11] },
  busNames: { 10: 'CAN Propulsion', 11: 'CAN Confort' },
  ecuNames: { 1: 'ECM', 2: 'TCM', 3: 'ABS', 4: 'Combiné' },
  ecuSupplyNodes: { 1: [900, 901], 2: [900], 3: [902], 4: [903] },
  nodeNames: { 900: 'Masse moteur 12', 901: 'Fusible SB15', 902: 'Masse 44', 903: 'Fusible SC3' },
};
const dtcs: DtcInput[] = [
  { id: 100, code: 'U0100', settingEcuId: 3, lostCommTargetId: 1 },
  { id: 101, code: 'U0101', settingEcuId: 4, lostCommTargetId: 2 },
  { id: 102, code: 'P0562', settingEcuId: 1, lostCommTargetId: null },
];
const t = (id: number, min: number, intr = 2, hv = false): TestRef => ({ procedureId: id, title: `T${id}`, estMinutes: min, intrusiveness: intr, requiresHv: hv });
const dbCauses: CauseCandidate[] = [
  { id: 'db:1', kind: 'component', label: 'ECM défectueux', dtcIds: [100, 102], prior: 0.2, componentId: 1, test: t(1, 15, 3) },
  { id: 'db:2', kind: 'component', label: 'TCM défectueux', dtcIds: [101], prior: 0.15, componentId: 2, test: t(2, 20, 3) },
  { id: 'db:99', kind: 'component', label: 'Sans rapport', dtcIds: [555], prior: 0.9, componentId: 7, test: t(9, 1, 1) },
];
const resolver = (c: CauseCandidate) =>
  c.kind === 'network' ? t(50, 10, 2) : c.id.startsWith('pwr:') ? t(51, 6, 1) : c.id.startsWith('ecu:') ? t(52, 8, 2) : undefined;
const ev = { tsbDtcIds: [], fieldCaseComponentHits: {} };

describe('multi-DTC engine', () => {
  it('infers a network cause and a shared-ground cause', () => {
    const causes = inferTopologyCauses(dtcs, topo);
    const ids = causes.map(c => c.id).sort();
    expect(ids).toContain('net:10');
    expect(ids).toContain('pwr:900');
    expect(causes.find(c => c.id === 'pwr:900')!.dtcIds.sort()).toEqual([100, 101, 102]);
  });

  it('ignores DB causes for codes that were not entered', () => {
    const s = startSession(dtcs, dbCauses, topo, ev, resolver);
    expect(s.candidates.some(c => c.id === 'db:99')).toBe(false);
  });

  it('ranks the cheap ground test that explains all codes first', () => {
    const s = startSession(dtcs, dbCauses, topo, ev, resolver);
    const ranked = rankTests(s);
    expect(ranked[0]!.cause.id).toBe('pwr:900');
    const total = Object.values(s.probs).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('re-ranks after a passing test and confirms after failures', () => {
    let s = startSession(dtcs, dbCauses, topo, ev, resolver);
    s = applyTestResult(s, 'pwr:900', 'pass');
    expect(rankTests(s)[0]!.cause.id).not.toBe('pwr:900');
    expect(() => applyTestResult(s, 'pwr:900', 'fail')).toThrow();
    s = applyTestResult(s, 'net:10', 'pass');
    s = applyTestResult(s, 'db:2', 'pass');
    s = applyTestResult(s, 'db:1', 'fail');
    expect(confirmedCause(s)?.id).toBe('db:1');
  });

  it('boosts causes backed by TSBs and field cases', () => {
    const base = startSession(dtcs, dbCauses, topo, ev, resolver);
    const boosted = startSession(dtcs, dbCauses, topo, { tsbDtcIds: [101], fieldCaseComponentHits: { 2: 5 } }, resolver);
    expect(boosted.probs['db:2']!).toBeGreaterThan(base.probs['db:2']!);
  });

  it('blocks HV tests until isolation', () => {
    const hvCause: CauseCandidate = { id: 'db:3', kind: 'component', label: 'Onduleur', dtcIds: [102], prior: 0.5, componentId: 5, test: t(3, 5, 1, true) };
    const s = startSession(dtcs, [hvCause], topo, ev, resolver, { hvRequired: true });
    const r = rankTests(s);
    expect(r.at(-1)!.cause.id).toBe('db:3');
    expect(r.at(-1)!.blockedByHv).toBe(true);
    expect(() => applyTestResult(s, 'db:3', 'fail')).toThrow(/HT/);
    expect(rankTests({ ...s, hvIsolated: true }).find(x => x.cause.id === 'db:3')!.blockedByHv).toBe(false);
  });

  it('enforces 1..10 codes', () => {
    expect(() => startSession([], [], topo, ev, resolver)).toThrow();
    const many = Array.from({ length: 11 }, (_, i) => ({ id: i, code: `P0${i}`, settingEcuId: null, lostCommTargetId: null }));
    expect(() => startSession(many, [], topo, ev, resolver)).toThrow();
  });

  it('evaluates measurements against spec windows', () => {
    expect(evaluateMeasurement(12.4, 11.5, 14.8)).toBe('pass');
    expect(evaluateMeasurement(9.8, 11.5, 14.8)).toBe('fail');
    expect(evaluateMeasurement(0.3, null, 0.5)).toBe('pass');
    expect(() => evaluateMeasurement(Number.NaN, 0, 1)).toThrow();
  });

  it('smooths priors from session outcomes', () => {
    expect(updatedPrior(0.2, 10, 10)).toBeCloseTo((0.2 * 20 + 10) / 30);
  });
});
