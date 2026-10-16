export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: any) { super(message); }
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = body?.message ?? `Erreur ${res.status}`;
    const issues = body?.issues?.map((i: any) => `${i.path}: ${i.message}`).join(' · ');
    throw new ApiError(issues ? `${msg} (${issues})` : msg, res.status, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | undefined | null>) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString()
      : '';
    return fetch(`/api${path}${qs === '?' ? '' : qs}`, { cache: 'no-store' }).then(r => handle<T>(r));
  },
  post: <T>(path: string, body: unknown) =>
    fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => handle<T>(r)),
};

// ---------- types (mirroring API responses) ----------
export interface Variant {
  id: number; make: string; model: string; generation: string; platformCode: string | null;
  engineCode: string | null; fuel: string | null; displacementCc: number | null;
  transmissionCode: string | null; transmissionKind: string | null;
  powerKw: number; powerHp: number; drive: string | null; hv: string; hvVoltage: number | null;
  yearFrom: number; yearTo: number | null; label: string;
}
export interface VariantDetail extends Variant {
  fluids: { system: string; capacity: number | null; unit: string; specification: string | null; viscosity: string | null }[];
  counts: { procedures: number; diagrams: number; laborOperations: number; tsbs: number; dtcs: number };
  source: { name: string; origin: string } | null;
}
export interface VinDecode {
  vin: string; valid: boolean; errors: string[]; warnings: string[]; wmi: string; vds: string; vis: string;
  region: string; checkDigit: string; modelYearCandidates: number[]; manufacturer: string | null;
  candidates: Variant[]; needsDisambiguation: boolean;
}
export interface SearchResult {
  kind: 'empty' | 'vin' | 'text'; decode?: VinDecode; vehicles: Variant[]; dtcs: { id: number; code: string; description: string }[];
}
export interface TreeMake { make: string; models: { model: string; generations: { generation: string; variants: Variant[] }[] }[] }

export interface TestRef { procedureId: number; title: string; estMinutes: number; intrusiveness: number; requiresHv: boolean }
export interface NextTest { causeId: string; label: string; kind: string; probability: number; explains: number; test: TestRef; blockedByHv: boolean }
export interface Candidate { id: string; kind: string; label: string; dtcIds: number[]; probability: number; test: TestRef | null; result: 'pass' | 'fail' | null; synthetic: boolean }
export interface SessionView {
  id: string; createdAt: string; variant: Variant; dtcs: { id: number; code: string; description: string }[];
  hvRequired: boolean; hvIsolated: boolean; hvProcedure: { id: number; title: string; steps: string[]; warnings: string[] } | null;
  next: NextTest[]; candidates: Candidate[]; results: { causeId: string; result: 'pass' | 'fail'; measured: number | null; at: string }[];
  stepLog: Record<string, { stepId: number; value?: number | null; ok?: boolean | null; verdict: 'pass' | 'fail' }[]>;
  confirmed: { id: string; label: string; probability: number } | null;
  closed: { at: string; causeId: string | null; note: string | null } | null;
  untestable: string[];
}
export interface Spec { id: number; measure: string; condition: string; min: number | null; max: number | null; unit: string; node: string; nodeId: number; ref: string | null }
export interface TestProcedure {
  id: number; title: string; minutes: number; intrusiveness: number; requiresHv: boolean; tools: string[];
  componentId: number | null; procedureRef: number | null;
  steps: { id: number; seq: number; instruction: string; spec: Spec | null }[];
  diagrams: { id: number; svgElementId: string; nodeId: number }[];
}
export interface Knowledge {
  tsbs: { id: number; number: string; kind: string; title: string; symptom: string; remedy: string; published: string; codes: string[] | null }[];
  fieldCases: { id: number; symptom: string; rootCause: string; fix: string; mileageKm: number | null; confirmations: number; codes: string[] | null; overlap: number }[];
}
export interface LaborOp { id: number; code: string; name: string; system: string; oemHours: number; steps: string[] }
export interface QuotePreview {
  method: 'single' | 'dag' | 'oem_rules'; grossHours: number; netHours: number; savedHours: number;
  lines: { stepId: number; code: string; name: string; hours: number; isAccess: boolean; sharedBy: string[] }[];
  operations: { id: number; code: string; name: string; oemHours: number }[]; warnings: string[];
  hourlyRateMillimes: number; totalMillimes: number; savedMillimes: number; totalFormatted: string; savedFormatted: string; rateFormatted: string;
}
export interface DiagramMeta {
  id: number; title: string; system: string; renderMode: string; version: number; sourceName: string; sourceOrigin: string; svgUrl: string;
  legend: { primary: string; stripe: string | null; signal: string }[];
}
export interface MaintenanceItem {
  id: number; task: string; status: 'overdue' | 'due' | 'upcoming' | 'ok'; statusLabel: string; nextKm: number | null; nextAgeMonths: number | null;
  remainingKm: number | null; remainingMonths: number | null; intervalKm: number | null; intervalMonths: number | null; operationId: number | null; oemHours: number | null;
}
export interface ProcedureSummary { id: number; kind: string; title: string; system: string; renderMode: string; torqueCount: number }
export interface ProcedureDetail extends ProcedureSummary {
  body: { steps: string[]; warnings?: string[]; tools?: string[] };
  version: number; language: string; sourceName: string; sourceOrigin: string;
  torque: { id: number; fastener: string; stages: { nm?: number; deg?: number }[]; replaceFastener: boolean }[];
}
