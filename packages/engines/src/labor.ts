/**
 * Smart overlapping labor engine.
 * Operations are made of steps (DAG). Access steps (teardown/refit) shared by several
 * operations are billed once. Core steps are scaled so a single operation equals its OEM time.
 * Explicit OEM overlap rules for a pair override the DAG computation.
 */

export interface LaborStep {
  id: number;
  code: string;
  name: string;
  hours: number;
  isAccess: boolean;
  requires: number[];
}

export interface LaborOperation {
  id: number;
  code: string;
  name: string;
  oemHours: number;
  stepIds: number[];
}

export interface OverlapRule { opA: number; opB: number; deductHours: number; }

export interface QuoteLine {
  stepId: number;
  code: string;
  name: string;
  hours: number;
  isAccess: boolean;
  sharedBy: string[];
}

export interface QuoteResult {
  method: 'single' | 'dag' | 'oem_rules';
  grossHours: number;
  netHours: number;
  savedHours: number;
  lines: QuoteLine[];
  operations: { id: number; code: string; name: string; oemHours: number }[];
  warnings: string[];
}

export const round2 = (x: number) => Math.round(x * 100) / 100;

/** Throws if the step graph contains a cycle or a missing dependency. */
export function validateStepGraph(steps: Map<number, LaborStep>): void {
  const state = new Map<number, 1 | 2>(); // 1 visiting, 2 done
  const visit = (id: number, path: number[]) => {
    const s = steps.get(id);
    if (!s) throw new Error(`Étape inconnue ${id} (référencée par ${path.at(-1) ?? '?'})`);
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`Cycle dans les étapes : ${[...path, id].join(' → ')}`);
    state.set(id, 1);
    for (const r of s.requires) visit(r, [...path, id]);
    state.set(id, 2);
  };
  for (const id of steps.keys()) visit(id, []);
}

export function stepClosure(stepIds: number[], steps: Map<number, LaborStep>): Set<number> {
  const seen = new Set<number>();
  const stack = [...stepIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    const s = steps.get(id);
    if (!s) throw new Error(`Étape inconnue ${id}`);
    seen.add(id);
    stack.push(...s.requires);
  }
  return seen;
}

function calibratedHours(op: LaborOperation, steps: Map<number, LaborStep>, warnings: string[]): Map<number, number> {
  const ids = stepClosure(op.stepIds, steps);
  let access = 0;
  let core = 0;
  for (const id of ids) {
    const s = steps.get(id)!;
    if (s.isAccess) access += s.hours; else core += s.hours;
  }
  if (access > op.oemHours + 1e-9) {
    warnings.push(`${op.code} : les étapes d'accès (${round2(access)} h) dépassent le temps constructeur (${op.oemHours} h).`);
  }
  const factor = core > 0 ? Math.max(0, op.oemHours - access) / core : 1;
  const out = new Map<number, number>();
  for (const id of ids) {
    const s = steps.get(id)!;
    out.set(id, s.isAccess ? s.hours : s.hours * factor);
  }
  return out;
}

export function computeQuote(
  operations: LaborOperation[],
  steps: Map<number, LaborStep>,
  rules: OverlapRule[] = [],
): QuoteResult {
  const warnings: string[] = [];
  const ops = [...new Map(operations.map(o => [o.id, o])).values()]; // dedupe
  if (ops.length !== operations.length) warnings.push('Opérations en double ignorées.');
  const opsInfo = ops.map(o => ({ id: o.id, code: o.code, name: o.name, oemHours: o.oemHours }));
  const grossHours = round2(ops.reduce((a, o) => a + o.oemHours, 0));

  if (ops.length === 0) {
    return { method: 'single', grossHours: 0, netHours: 0, savedHours: 0, lines: [], operations: [], warnings };
  }

  // OEM pair rule takes precedence for exactly two operations
  if (ops.length === 2) {
    const [a, b] = [Math.min(ops[0]!.id, ops[1]!.id), Math.max(ops[0]!.id, ops[1]!.id)];
    const rule = rules.find(r => Math.min(r.opA, r.opB) === a && Math.max(r.opA, r.opB) === b);
    if (rule) {
      const net = round2(Math.max(0, grossHours - rule.deductHours));
      return { method: 'oem_rules', grossHours, netHours: net, savedHours: round2(grossHours - net), lines: [], operations: opsInfo, warnings };
    }
  }

  const lines = new Map<number, QuoteLine>();
  for (const op of ops) {
    for (const [id, h] of calibratedHours(op, steps, warnings)) {
      const s = steps.get(id)!;
      const existing = lines.get(id);
      if (existing) {
        existing.sharedBy.push(op.code);
        if (!s.isAccess) existing.hours += h; // core work is never shared
      } else {
        lines.set(id, { stepId: id, code: s.code, name: s.name, hours: h, isAccess: s.isAccess, sharedBy: [op.code] });
      }
    }
  }
  const outLines = [...lines.values()]
    .map(l => ({ ...l, hours: round2(l.hours) }))
    .sort((x, y) => Number(y.isAccess) - Number(x.isAccess) || y.sharedBy.length - x.sharedBy.length);
  const netHours = round2(outLines.reduce((a, l) => a + l.hours, 0));
  return {
    method: ops.length === 1 ? 'single' : 'dag',
    grossHours,
    netHours,
    savedHours: round2(Math.max(0, grossHours - netHours)),
    lines: outLines,
    operations: opsInfo,
    warnings,
  };
}

/** Price in millimes (TND has 3 decimals) to avoid floating-point money. */
export function laborPriceMillimes(hours: number, hourlyRateMillimes: number): number {
  return Math.round(hours * hourlyRateMillimes);
}

export function formatTnd(millimes: number): string {
  const sign = millimes < 0 ? '-' : '';
  const abs = Math.abs(millimes);
  const dt = Math.floor(abs / 1000);
  const m = String(abs % 1000).padStart(3, '0');
  return `${sign}${dt.toLocaleString('fr-FR').replace(/ | /g, ' ')},${m} DT`;
}
