import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  MAX_DTCS, applyTestResult, confirmedCause, evaluateMeasurement, rankTests, startSession,
  type CauseCandidate, type CauseKind, type DtcInput, type EvidenceInput, type SessionState, type TestRef, type TopologyInput,
} from '@autotech/engines';
import { DbService, applies } from '../db/db.service';
import { WiringService } from '../wiring/wiring.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { config } from '../config';
import { domain } from '../common/errors.filter';

interface StoredState extends SessionState {
  hvLog?: { at: string; confirmedSteps: number }[];
  stepLog?: Record<string, { stepId: number; value?: number | null; ok?: boolean | null; verdict: 'pass' | 'fail' }[]>;
  closed?: { at: string; causeId: string | null; note: string | null };
}

export interface StepInput { stepId: number; value?: number | null; ok?: boolean | null }

@Injectable()
export class DiagnosticsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(WiringService) private readonly wiring: WiringService,
    @Inject(VehiclesService) private readonly vehicles: VehiclesService,
  ) {}

  /** DTC lookup for the input field (codes known for this vehicle first). */
  async searchDtcs(variantId: number, q: string) {
    return this.db.query(
      `SELECT d.id, d.code, d.description,
              EXISTS (SELECT 1 FROM dtc_vehicle_link l WHERE l.dtc_id = d.id AND ${applies('l')}) AS "knownForVehicle"
       FROM dtc_definition d
       WHERE ($2 = '' OR d.code ILIKE $2 || '%' OR d.description ILIKE '%' || $2 || '%')
       ORDER BY "knownForVehicle" DESC, d.code LIMIT 15`, [variantId, q.trim()]);
  }

  private async topology(variantId: number, ecuIds: number[]): Promise<TopologyInput> {
    const busRows = await this.db.query<{ busId: number; busName: string; componentId: number; componentName: string }>(
      `SELECT b.id AS "busId", b.name AS "busName", c.id AS "componentId", coalesce(c.oem_ref || ' ', '') || c.name AS "componentName"
       FROM network_bus b JOIN bus_node bn ON bn.bus_id = b.id JOIN component c ON c.id = bn.component_id
       WHERE ${applies('b')}`, [variantId]);
    const topo: TopologyInput = { ecuBuses: {}, busNames: {}, ecuNames: {}, ecuSupplyNodes: {}, nodeNames: {} };
    for (const r of busRows) {
      (topo.ecuBuses[r.componentId] ??= []).push(r.busId);
      topo.busNames[r.busId] = r.busName;
      topo.ecuNames[r.componentId] = r.componentName;
    }
    for (const ecu of ecuIds) {
      const nodes = await this.wiring.supplyNodes(ecu);
      topo.ecuSupplyNodes[ecu] = nodes.map(n => n.id);
      for (const n of nodes) topo.nodeNames[n.id] = n.name;
      if (!topo.ecuNames[ecu]) {
        const c = await this.db.one(`SELECT coalesce(oem_ref || ' ', '') || name AS name FROM component WHERE id = $1`, [ecu]);
        if (c) topo.ecuNames[ecu] = c.name;
      }
    }
    return topo;
  }

  private async dbCauses(variantId: number, dtcIds: number[]): Promise<CauseCandidate[]> {
    const rows = await this.db.query(
      `SELECT dc.id, dc.dtc_id AS "dtcId", dc.cause_kind AS kind, dc.prior_weight AS prior, dc.component_id AS "componentId",
              dc.wire_id AS "wireId", dc.bus_id AS "busId",
              c.oem_ref AS "componentRef", c.name AS "componentName",
              tp.id AS "procedureId", tp.title AS "testTitle", tp.est_minutes AS minutes, tp.intrusiveness, tp.requires_hv_isolation AS hv
       FROM dtc_cause dc
       LEFT JOIN component c ON c.id = dc.component_id
       LEFT JOIN test_procedure tp ON tp.id = dc.test_procedure_id
       WHERE dc.dtc_id = ANY($2) AND ${applies('dc')}
       ORDER BY dc.id`, [variantId, dtcIds]);
    const KIND_LABEL: Record<string, string> = {
      component: 'composant défectueux', open_circuit: 'circuit ouvert', short_to_ground: 'court-circuit à la masse',
      short_to_battery: 'court-circuit au +', connector: 'connecteur', network: 'réseau', power_supply: 'alimentation / masse',
      software: 'logiciel / codage', mechanical: 'cause mécanique',
    };
    // merge identical causes reported for several DTCs → one candidate explaining all of them
    const merged = new Map<string, CauseCandidate>();
    for (const r of rows) {
      const key = [r.kind, r.componentId, r.wireId, r.busId, r.procedureId].join('|');
      const existing = merged.get(key);
      if (existing) {
        existing.dtcIds.push(r.dtcId);
        existing.prior = Math.max(existing.prior, r.prior);
        continue;
      }
      const test: TestRef | undefined = r.procedureId
        ? { procedureId: r.procedureId, title: r.testTitle, estMinutes: r.minutes, intrusiveness: r.intrusiveness, requiresHv: r.hv }
        : undefined;
      const name = r.componentName ? `${r.componentRef && /\d/.test(r.componentRef) ? r.componentRef + ' ' : ''}${r.componentName}` : 'Cause';
      merged.set(key, {
        id: `db:${r.id}`, kind: r.kind as CauseKind, label: `${name} — ${KIND_LABEL[r.kind] ?? r.kind}`,
        dtcIds: [r.dtcId], prior: r.prior, componentId: r.componentId, busId: r.busId, test,
      });
    }
    return [...merged.values()];
  }

  private async evidence(variantId: number, dtcIds: number[]): Promise<EvidenceInput> {
    const tsb = await this.db.query<{ dtc_id: number }>(
      `SELECT DISTINCT td.dtc_id FROM tsb_dtc td JOIN tsb t ON t.id = td.tsb_id WHERE td.dtc_id = ANY($2) AND ${applies('t')}`, [variantId, dtcIds]);
    const cases = await this.db.query<{ componentId: number | null; nodeId: number | null; weight: number }>(
      `SELECT fc.component_id AS "componentId", fc.node_id AS "nodeId",
              1 + (SELECT count(*) FROM field_case_feedback f WHERE f.case_id = fc.id AND f.outcome = 'fixed')::int AS weight
       FROM field_case fc
       WHERE fc.status = 'verified' AND ${applies('fc')}
         AND EXISTS (SELECT 1 FROM field_case_dtc x WHERE x.case_id = fc.id AND x.dtc_id = ANY($2))`, [variantId, dtcIds]);
    const ev: EvidenceInput = { tsbDtcIds: tsb.map(t => t.dtc_id), fieldCaseComponentHits: {}, fieldCaseNodeHits: {} };
    for (const c of cases) {
      if (c.componentId) ev.fieldCaseComponentHits[c.componentId] = (ev.fieldCaseComponentHits[c.componentId] ?? 0) + c.weight;
      if (c.nodeId) ev.fieldCaseNodeHits![c.nodeId] = (ev.fieldCaseNodeHits![c.nodeId] ?? 0) + c.weight;
    }
    return ev;
  }

  private async testResolver(variantId: number) {
    const tests = await this.db.query(
      `SELECT id, title, est_minutes AS minutes, intrusiveness, requires_hv_isolation AS hv, target_kind AS "targetKind",
              bus_id AS "busId", node_id AS "nodeId", component_id AS "componentId"
       FROM test_procedure tp WHERE ${applies('tp')} AND target_kind <> 'component'`, [variantId]);
    const toRef = (t: any): TestRef => ({ procedureId: t.id, title: t.title, estMinutes: t.minutes, intrusiveness: t.intrusiveness, requiresHv: t.hv });
    return (c: CauseCandidate): TestRef | undefined => {
      const hit = c.id.startsWith('net:') ? tests.find(t => t.targetKind === 'bus' && t.busId === c.busId)
        : c.id.startsWith('pwr:') ? tests.find(t => t.targetKind === 'node' && t.nodeId === c.nodeId)
          : c.id.startsWith('ecu:') ? tests.find(t => t.targetKind === 'ecu_supply' && t.componentId === c.componentId)
            : undefined;
      return hit ? toRef(hit) : undefined;
    };
  }

  async start(variantId: number, codes: string[]) {
    const variant = await this.vehicles.variant(variantId);
    const normalised = [...new Set(codes.map(c => c.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)).filter(Boolean))];
    if (normalised.length < 1 || normalised.length > MAX_DTCS) throw new BadRequestException(`Saisissez entre 1 et ${MAX_DTCS} codes défaut.`);
    const defs = await this.db.query<{ id: number; code: string; description: string }>(
      `SELECT d.id, d.code, d.description FROM dtc_definition d
       JOIN make mk ON mk.name = $2
       WHERE d.code = ANY($1) AND (d.make_id IS NULL OR d.make_id = mk.id)`, [normalised, variant.make]);
    const unknown = normalised.filter(c => !defs.some(d => d.code === c));
    if (unknown.length) throw new BadRequestException({ message: `Code(s) inconnu(s) dans la base : ${unknown.join(', ')}`, unknown });

    const dtcIds = defs.map(d => d.id);
    const links = await this.db.query<{ dtcId: number; setting: number | null; lost: number | null }>(
      `SELECT dtc_id AS "dtcId", setting_component_id AS setting, lost_comm_component_id AS lost
       FROM dtc_vehicle_link l WHERE l.dtc_id = ANY($2) AND ${applies('l')}`, [variantId, dtcIds]);
    const dtcs: DtcInput[] = defs.map(d => {
      const l = links.find(x => x.dtcId === d.id);
      return { id: d.id, code: d.code, settingEcuId: l?.setting ?? null, lostCommTargetId: l?.lost ?? null };
    });
    const ecuIds = [...new Set(dtcs.flatMap(d => [d.settingEcuId, d.lostCommTargetId]).filter((x): x is number => x != null))];

    const [causes, topo, ev, resolver] = await Promise.all([
      this.dbCauses(variantId, dtcIds), this.topology(variantId, ecuIds), this.evidence(variantId, dtcIds), this.testResolver(variantId),
    ]);
    const session: StoredState = domain(() => startSession(dtcs, causes, topo, ev, resolver, { hvRequired: variant.hv !== 'none' }));
    session.stepLog = {};
    session.hvLog = [];

    const row = await this.db.one<{ id: string }>(
      `INSERT INTO diag_session (org_id, user_id, variant_id, dtc_ids, state) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [config.demoOrgId, config.demoUserId, variantId, dtcIds, JSON.stringify(session)]);
    return this.view(row!.id);
  }

  private async load(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Session introuvable');
    const row = await this.db.one<{ id: string; variant_id: number; dtc_ids: number[]; state: StoredState; created_at: string; outcome_cause_id: number | null }>(
      `SELECT id, variant_id, dtc_ids, state, created_at, outcome_cause_id FROM diag_session WHERE id = $1 AND org_id = $2`, [id, config.demoOrgId]);
    if (!row) throw new NotFoundException('Session introuvable');
    return row;
  }

  async view(id: string) {
    const row = await this.load(id);
    const s = row.state;
    const variant = await this.vehicles.variant(row.variant_id);
    const dtcs = await this.db.query(`SELECT id, code, description FROM dtc_definition WHERE id = ANY($1) ORDER BY code`, [row.dtc_ids]);
    const ranked = rankTests(s);
    const done = new Map(s.results.map(r => [r.causeId, r]));
    const candidates = [...s.candidates]
      .map(c => ({
        id: c.id, kind: c.kind, label: c.label, dtcIds: c.dtcIds, probability: s.probs[c.id] ?? 0,
        test: c.test ?? null, result: done.get(c.id)?.result ?? null, synthetic: !c.id.startsWith('db:'),
      }))
      .sort((a, b) => b.probability - a.probability);
    const confirmed = confirmedCause(s);
    const hvProcedure = s.hvRequired ? await this.hvProcedure(row.variant_id) : null;
    return {
      id: row.id,
      createdAt: row.created_at,
      variant,
      dtcs,
      hvRequired: s.hvRequired,
      hvIsolated: s.hvIsolated,
      hvProcedure,
      next: ranked.map(r => ({
        causeId: r.cause.id, label: r.cause.label, kind: r.cause.kind, probability: r.probability,
        explains: r.cause.dtcIds.length, test: r.cause.test!, blockedByHv: r.blockedByHv,
      })),
      candidates,
      results: s.results,
      stepLog: s.stepLog ?? {},
      confirmed: confirmed ? { id: confirmed.id, label: confirmed.label, probability: s.probs[confirmed.id] } : null,
      closed: s.closed ?? null,
      untestable: candidates.filter(c => !c.test).map(c => c.label),
    };
  }

  async testProcedure(id: number) {
    const tp = await this.db.one(
      `SELECT tp.id, tp.title, tp.est_minutes AS minutes, tp.intrusiveness, tp.requires_hv_isolation AS "requiresHv", tp.tools,
              tp.component_id AS "componentId", tp.procedure_ref AS "procedureRef"
       FROM test_procedure tp WHERE tp.id = $1`, [id]);
    if (!tp) throw new NotFoundException('Test introuvable');
    const steps = await this.db.query(
      `SELECT s.id, s.seq, s.instruction_md AS instruction,
              CASE WHEN ps.id IS NULL THEN NULL ELSE json_build_object(
                'id', ps.id, 'measure', ps.measure, 'condition', ps.condition, 'min', ps.expected_min, 'max', ps.expected_max,
                'unit', ps.unit, 'node', n.name, 'nodeId', n.id, 'ref', r.name) END AS spec
       FROM test_step s
       LEFT JOIN pin_spec ps ON ps.id = s.pin_spec_id
       LEFT JOIN electrical_node n ON n.id = ps.node_id
       LEFT JOIN electrical_node r ON r.id = ps.ref_node_id
       WHERE s.procedure_id = $1 ORDER BY s.seq`, [id]);
    // diagrams where the measured nodes are drawn (for "show on diagram")
    const nodeIds = steps.flatMap(s => (s.spec ? [s.spec.nodeId] : []));
    const diagrams = nodeIds.length
      ? await this.db.query(`SELECT DISTINCT de.diagram_id AS id, de.svg_element_id AS "svgElementId", de.entity_id AS "nodeId"
          FROM diagram_element de WHERE de.entity_kind IN ('node','ground') AND de.entity_id = ANY($1)`, [nodeIds])
      : [];
    return { ...tp, steps, diagrams };
  }

  async record(id: string, causeId: string, steps: StepInput[]) {
    const row = await this.load(id);
    const s = row.state;
    if (s.closed) throw new BadRequestException('Session clôturée.');
    const cause = s.candidates.find(c => c.id === causeId);
    if (!cause?.test) throw new BadRequestException('Cause inconnue ou sans test.');
    const proc = await this.testProcedure(cause.test.procedureId);
    const verdicts: { stepId: number; value?: number | null; ok?: boolean | null; verdict: 'pass' | 'fail' }[] = [];
    for (const step of proc.steps) {
      const input = steps.find(x => x.stepId === step.id);
      if (!input) throw new BadRequestException(`Étape ${step.seq} non renseignée.`);
      if (step.spec) {
        if (input.value == null) throw new BadRequestException(`Étape ${step.seq} : valeur mesurée requise (${step.spec.unit}).`);
        verdicts.push({ stepId: step.id, value: input.value, verdict: domain(() => evaluateMeasurement(input.value!, step.spec.min, step.spec.max)) });
      } else {
        if (input.ok == null) throw new BadRequestException(`Étape ${step.seq} : réponse oui/non requise.`);
        verdicts.push({ stepId: step.id, ok: input.ok, verdict: input.ok ? 'pass' : 'fail' });
      }
    }
    const result = verdicts.some(v => v.verdict === 'fail') ? 'fail' : 'pass';
    const firstFail = verdicts.find(v => v.verdict === 'fail');
    const next: StoredState = domain(() => applyTestResult(s, causeId, result, firstFail?.value ?? null));
    next.stepLog = { ...(s.stepLog ?? {}), [causeId]: verdicts };
    next.hvLog = s.hvLog ?? [];
    await this.db.query(`UPDATE diag_session SET state = $2 WHERE id = $1`, [id, JSON.stringify(next)]);
    return this.view(id);
  }

  async hvProcedure(variantId: number) {
    const p = await this.db.one(
      `SELECT p.id, p.title, p.body FROM procedure p WHERE p.kind = 'hv_deactivation' AND ${applies('p')} ORDER BY p.version DESC LIMIT 1`, [variantId]);
    return p ? { id: p.id, title: p.title, steps: p.body.steps as string[], warnings: (p.body.warnings ?? []) as string[] } : null;
  }

  async confirmHvIsolation(id: string, confirmedSteps: number[]) {
    const row = await this.load(id);
    const s = row.state;
    if (!s.hvRequired) throw new BadRequestException("Ce véhicule n'a pas de système haute tension.");
    const proc = await this.hvProcedure(row.variant_id);
    if (!proc) throw new BadRequestException('Procédure de consignation HT absente pour ce véhicule.');
    const all = proc.steps.map((_, i) => i);
    const missing = all.filter(i => !confirmedSteps.includes(i));
    if (missing.length) throw new BadRequestException(`Étapes de consignation non confirmées : ${missing.map(i => i + 1).join(', ')}`);
    const next: StoredState = { ...s, hvIsolated: true, hvLog: [...(s.hvLog ?? []), { at: new Date().toISOString(), confirmedSteps: all.length }] };
    await this.db.query(`UPDATE diag_session SET state = $2 WHERE id = $1`, [id, JSON.stringify(next)]);
    return this.view(id);
  }

  async close(id: string, causeId: string | null, note: string | null) {
    const row = await this.load(id);
    const s = row.state;
    if (causeId && !s.candidates.some(c => c.id === causeId)) throw new BadRequestException('Cause inconnue.');
    const outcome = causeId?.startsWith('db:') ? Number(causeId.slice(3)) : null;
    const next: StoredState = { ...s, closed: { at: new Date().toISOString(), causeId, note } };
    await this.db.query(`UPDATE diag_session SET state = $2, outcome_cause_id = $3 WHERE id = $1`, [id, JSON.stringify(next), outcome]);
    return this.view(id);
  }

  async recent() {
    return this.db.query(
      `SELECT s.id, s.created_at AS "createdAt", s.variant_id AS "variantId",
              (SELECT string_agg(code, ' ' ORDER BY code) FROM dtc_definition WHERE id = ANY(s.dtc_ids)) AS codes,
              s.state->'closed' IS NOT NULL AND s.state->>'closed' <> 'null' AS closed
       FROM diag_session s WHERE s.org_id = $1 ORDER BY s.created_at DESC LIMIT 10`, [config.demoOrgId]);
  }

  /** TSBs and verified field cases relevant to a set of codes (knowledge panel). */
  async knowledge(variantId: number, dtcIds: number[]) {
    const tsbs = await this.db.query(
      `SELECT t.id, t.oem_number AS number, t.kind, t.title, t.symptom_md AS symptom, t.remedy_md AS remedy, t.published_at AS published,
              array_agg(d.code ORDER BY d.code) FILTER (WHERE d.id IS NOT NULL) AS codes
       FROM tsb t LEFT JOIN tsb_dtc td ON td.tsb_id = t.id LEFT JOIN dtc_definition d ON d.id = td.dtc_id
       WHERE ${applies('t')} AND (cardinality($2::bigint[]) = 0 OR td.dtc_id = ANY($2))
       GROUP BY t.id ORDER BY t.published_at DESC`, [variantId, dtcIds]);
    const fieldCases = await this.db.query(
      `SELECT fc.id, fc.symptom, fc.root_cause AS "rootCause", fc.fix_md AS fix, fc.mileage_km AS "mileageKm",
              (SELECT count(*)::int FROM field_case_feedback f WHERE f.case_id = fc.id AND f.outcome = 'fixed') AS confirmations,
              (SELECT array_agg(d.code ORDER BY d.code) FROM field_case_dtc x JOIN dtc_definition d ON d.id = x.dtc_id WHERE x.case_id = fc.id) AS codes,
              (SELECT count(*)::int FROM field_case_dtc x WHERE x.case_id = fc.id AND x.dtc_id = ANY($2)) AS overlap
       FROM field_case fc
       WHERE fc.status = 'verified' AND ${applies('fc')}
       ORDER BY overlap DESC, confirmations DESC LIMIT 10`, [variantId, dtcIds]);
    return { tsbs, fieldCases: dtcIds.length ? fieldCases.filter(f => f.overlap > 0) : fieldCases };
  }
}
