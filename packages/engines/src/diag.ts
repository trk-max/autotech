/**
 * Multi-DTC guided diagnostic engine (VESA-class).
 *
 * 1. Candidate causes come from the database (dtc_cause) + causes inferred from topology:
 *    - several "lost communication" DTCs on one bus      → network cause (wiring/termination/gateway)
 *    - several ECUs reporting the same silent ECU          → that ECU's supply/ground/module
 *    - several DTC-setting ECUs sharing a supply/ground    → shared power-supply cause
 * 2. Each cause is scored: prior × explanatory power × TSB / field-case boosts, then normalised.
 * 3. Tests are ranked by probability per weighted minute (cheap, non-intrusive tests first).
 * 4. Each result updates the probabilities (Bayesian-style multiplicative update) and re-ranks.
 */

export const MAX_DTCS = 10;
const INTRUSIVENESS_PENALTY = [1, 1, 1.3, 1.8, 2.6, 4]; // index = intrusiveness 1..5
const PASS_FACTOR = 0.05;   // test in spec → cause very unlikely
const FAIL_FACTOR = 8;      // test out of spec → strong evidence for this cause
export const CONFIRM_THRESHOLD = 0.8;

export type CauseKind =
  | 'component' | 'open_circuit' | 'short_to_ground' | 'short_to_battery'
  | 'connector' | 'network' | 'power_supply' | 'software' | 'mechanical';

export interface DtcInput {
  id: number;
  code: string;
  settingEcuId: number | null;      // ECU that stores the code
  lostCommTargetId: number | null;  // for Uxxxx "lost communication with X"
}

export interface TestRef {
  procedureId: number;
  title: string;
  estMinutes: number;
  intrusiveness: number;  // 1 = scan tool / visual … 5 = teardown
  requiresHv: boolean;
}

export interface CauseCandidate {
  id: string;             // 'db:12' | 'net:3' | 'ecu:41' | 'pwr:900'
  kind: CauseKind;
  label: string;
  dtcIds: number[];
  prior: number;          // 0..1
  componentId?: number | null;
  busId?: number | null;
  nodeId?: number | null;
  test?: TestRef;
}

export interface TopologyInput {
  ecuBuses: Record<number, number[]>;          // ecu component id → bus ids
  busNames: Record<number, string>;
  ecuNames: Record<number, string>;
  ecuSupplyNodes: Record<number, number[]>;    // ecu id → fuse/ground node ids feeding it
  nodeNames: Record<number, string>;
}

export interface EvidenceInput {
  tsbDtcIds: number[];                          // DTCs covered by an applicable TSB
  fieldCaseComponentHits: Record<number, number>; // component id → verified field cases
  fieldCaseNodeHits?: Record<number, number>;      // node id (ground/fuse) → verified field cases
}

export type TestResult = 'pass' | 'fail';

export interface SessionState {
  dtcIds: number[];
  candidates: CauseCandidate[];
  probs: Record<string, number>;
  results: { causeId: string; result: TestResult; measured?: number | null; at: string }[];
  hvRequired: boolean;
  hvIsolated: boolean;
}

export interface RankedTest {
  cause: CauseCandidate;
  probability: number;
  utility: number;
  blockedByHv: boolean;
}

export type TestResolver = (cause: CauseCandidate) => TestRef | undefined;

export function inferTopologyCauses(dtcs: DtcInput[], topo: TopologyInput): CauseCandidate[] {
  const out: CauseCandidate[] = [];

  // A. lost-communication clustering
  const lostByBus = new Map<number, Set<number>>();
  const lostByTarget = new Map<number, Set<number>>();
  for (const d of dtcs) {
    const target = d.lostCommTargetId;
    if (target == null) continue;
    for (const bus of topo.ecuBuses[target] ?? []) {
      if (!lostByBus.has(bus)) lostByBus.set(bus, new Set());
      lostByBus.get(bus)!.add(d.id);
    }
    if (!lostByTarget.has(target)) lostByTarget.set(target, new Set());
    lostByTarget.get(target)!.add(d.id);
  }
  for (const [bus, ids] of lostByBus) {
    if (ids.size >= 2) {
      out.push({
        id: `net:${bus}`, kind: 'network', busId: bus,
        label: `${topo.busNames[bus] ?? `Bus ${bus}`} : câblage, terminaison ou passerelle`,
        dtcIds: [...ids], prior: 0.35,
      });
    }
  }
  for (const [ecu, ids] of lostByTarget) {
    if (ids.size >= 2) {
      out.push({
        id: `ecu:${ecu}`, kind: 'power_supply', componentId: ecu,
        label: `${topo.ecuNames[ecu] ?? `Calculateur ${ecu}`} muet : alimentation, masse ou calculateur`,
        dtcIds: [...ids], prior: 0.4,
      });
    }
  }

  // B. supply / ground shared by several ECUs involved in the codes
  const involved = new Map<number, Set<number>>(); // ecu → dtc ids
  for (const d of dtcs) {
    for (const ecu of [d.settingEcuId, d.lostCommTargetId]) {
      if (ecu == null) continue;
      if (!involved.has(ecu)) involved.set(ecu, new Set());
      involved.get(ecu)!.add(d.id);
    }
  }
  const nodeToEcus = new Map<number, Set<number>>();
  for (const ecu of involved.keys()) {
    for (const node of topo.ecuSupplyNodes[ecu] ?? []) {
      if (!nodeToEcus.has(node)) nodeToEcus.set(node, new Set());
      nodeToEcus.get(node)!.add(ecu);
    }
  }
  for (const [node, ecus] of nodeToEcus) {
    if (ecus.size < 2) continue;
    const dtcIds = new Set<number>();
    for (const ecu of ecus) for (const id of involved.get(ecu)!) dtcIds.add(id);
    out.push({
      id: `pwr:${node}`, kind: 'power_supply', nodeId: node,
      label: `Alimentation/masse commune : ${topo.nodeNames[node] ?? `nœud ${node}`}`,
      dtcIds: [...dtcIds], prior: 0.3,
    });
  }
  return out;
}

export function scoreCauses(dtcCount: number, causes: CauseCandidate[], ev: EvidenceInput): Record<string, number> {
  const tsb = new Set(ev.tsbDtcIds);
  const raw: Record<string, number> = {};
  for (const c of causes) {
    const coverage = dtcCount > 0 ? c.dtcIds.length / dtcCount : 0;
    const parsimony = Math.pow(coverage, 1.5);
    const tsbBoost = c.dtcIds.some(id => tsb.has(id)) && c.componentId != null ? 1.5 : 1;
    const hits = (c.componentId != null ? (ev.fieldCaseComponentHits[c.componentId] ?? 0) : 0)
      + (c.nodeId != null ? (ev.fieldCaseNodeHits?.[c.nodeId] ?? 0) : 0);
    const fieldBoost = 1 + Math.log1p(hits) * 0.4;
    raw[c.id] = c.prior * (0.2 + parsimony) * tsbBoost * fieldBoost;
  }
  return normalise(raw);
}

function normalise(p: Record<string, number>): Record<string, number> {
  const total = Object.values(p).reduce((a, b) => a + b, 0);
  if (total <= 0) return p;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) out[k] = v / total;
  return out;
}

export function rankTests(state: SessionState): RankedTest[] {
  const done = new Set(state.results.map(r => r.causeId));
  return state.candidates
    .filter(c => c.test && !done.has(c.id))
    .map(c => {
      const p = state.probs[c.id] ?? 0;
      const t = c.test!;
      const penalty = INTRUSIVENESS_PENALTY[Math.min(5, Math.max(1, t.intrusiveness))]!;
      const cost = Math.max(1, t.estMinutes) * penalty;
      return { cause: c, probability: p, utility: p / cost, blockedByHv: t.requiresHv && !state.hvIsolated };
    })
    .sort((a, b) => Number(a.blockedByHv) - Number(b.blockedByHv) || b.utility - a.utility);
}

export function startSession(
  dtcs: DtcInput[],
  dbCauses: CauseCandidate[],
  topo: TopologyInput,
  ev: EvidenceInput,
  resolveTest: TestResolver,
  opts: { hvRequired?: boolean } = {},
): SessionState {
  if (dtcs.length < 1 || dtcs.length > MAX_DTCS) throw new Error(`Entre 1 et ${MAX_DTCS} codes défaut requis.`);
  const ids = new Set(dtcs.map(d => d.id));
  const causes = [...dbCauses.filter(c => c.dtcIds.some(id => ids.has(id))), ...inferTopologyCauses(dtcs, topo)]
    .map(c => ({ ...c, dtcIds: c.dtcIds.filter(id => ids.has(id)), test: c.test ?? resolveTest(c) }));
  return {
    dtcIds: [...ids],
    candidates: causes,
    probs: scoreCauses(ids.size, causes, ev),
    results: [],
    hvRequired: !!opts.hvRequired,
    hvIsolated: false,
  };
}

export function applyTestResult(state: SessionState, causeId: string, result: TestResult, measured?: number | null): SessionState {
  if (!state.candidates.some(c => c.id === causeId)) throw new Error(`Cause inconnue : ${causeId}`);
  if (state.results.some(r => r.causeId === causeId)) throw new Error('Ce test a déjà été enregistré.');
  const cause = state.candidates.find(c => c.id === causeId)!;
  if (cause.test?.requiresHv && !state.hvIsolated) throw new Error('Mise hors tension HT requise avant ce test.');
  const probs = { ...state.probs };
  probs[causeId] = (probs[causeId] ?? 0) * (result === 'pass' ? PASS_FACTOR : FAIL_FACTOR);
  return {
    ...state,
    probs: normalise(probs),
    results: [...state.results, { causeId, result, measured: measured ?? null, at: new Date().toISOString() }],
  };
}

/** A cause is considered confirmed when its own test failed and it dominates the distribution. */
export function confirmedCause(state: SessionState): CauseCandidate | null {
  const failed = state.results.filter(r => r.result === 'fail').map(r => r.causeId);
  let best: CauseCandidate | null = null;
  for (const id of failed) {
    const p = state.probs[id] ?? 0;
    if (p >= CONFIRM_THRESHOLD && (!best || p > (state.probs[best.id] ?? 0))) {
      best = state.candidates.find(c => c.id === id) ?? null;
    }
  }
  return best;
}

/** Pass/fail from a measured value and a spec window (either bound may be open). */
export function evaluateMeasurement(value: number, min: number | null, max: number | null): TestResult {
  if (Number.isNaN(value)) throw new Error('Valeur mesurée invalide.');
  if (min != null && value < min) return 'fail';
  if (max != null && value > max) return 'fail';
  return 'pass';
}

/** Bayesian count smoothing used by the learning loop on closed sessions. */
export function updatedPrior(prior: number, confirmations: number, sessions: number, strength = 20): number {
  return (prior * strength + confirmations) / (strength + sessions);
}
