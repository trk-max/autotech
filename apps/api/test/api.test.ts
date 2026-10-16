/**
 * Integration tests against a real PostgreSQL seeded with the demo data (pnpm db:reset).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';

let app: INestApplication;
let http: any;
let golf20: number;
let yaris: number;

beforeAll(async () => {
  app = await createApp({ logger: false });
  await app.init();
  http = app.getHttpServer();
  const tree = (await request(http).get('/api/vehicles/tree')).body;
  const variants = tree.flatMap((m: any) => m.models.flatMap((mo: any) => mo.generations.flatMap((g: any) => g.variants)));
  golf20 = variants.find((v: any) => v.engineCode === 'CRLB').id;
  yaris = variants.find((v: any) => v.hv === 'hev').id;
});
afterAll(async () => { await app?.close(); });

describe('vehicle identification', () => {
  it('decodes a Golf VIN with disambiguation', async () => {
    const r = await request(http).get('/api/vehicles/vin/WVWZZZAUZFW123456').expect(200);
    expect(r.body.valid).toBe(true);
    expect(r.body.manufacturer).toBe('Volkswagen');
    expect(r.body.candidates).toHaveLength(2);
    expect(r.body.needsDisambiguation).toBe(true);
  });
  it('rejects an invalid VIN with explicit errors', async () => {
    const r = await request(http).get('/api/vehicles/vin/WVWZZZAUZFW12345O').expect(200);
    expect(r.body.valid).toBe(false);
    expect(r.body.errors.join(' ')).toMatch(/I, O et Q/);
  });
  it('finds vehicles by free text with aliases', async () => {
    const r = await request(http).get('/api/search').query({ q: 'golf 7 2.0 tdi' }).expect(200);
    expect(r.body.kind).toBe('text');
    expect(r.body.vehicles.map((v: any) => v.engineCode)).toEqual(['CRLB']);
  });
  it('routes VIN-like queries to the decoder', async () => {
    const r = await request(http).get('/api/search').query({ q: 'VNKKD3D30JA123456' }).expect(200);
    expect(r.body.kind).toBe('vin');
    expect(r.body.decode.candidates[0].hv).toBe('hev');
  });
});

describe('multi-DTC diagnostics', () => {
  it('ranks the shared ground first, then confirms it on a failed measurement', async () => {
    const start = await request(http).post('/api/diagnostics/sessions').send({ variantId: golf20, codes: ['U0100', 'u0101', 'P0562'] }).expect(201);
    const first = start.body.next[0];
    expect(first.label).toMatch(/masse 12/);
    expect(first.explains).toBe(3);
    const proc = (await request(http).get(`/api/test-procedures/${first.test.procedureId}`).expect(200)).body;
    const steps = proc.steps.map((s: any) => (s.spec ? { stepId: s.id, value: 0.6 } : { stepId: s.id, ok: false }));
    const after = await request(http).post(`/api/diagnostics/sessions/${start.body.id}/results`).send({ causeId: first.causeId, steps }).expect(201);
    expect(after.body.confirmed?.id).toBe(first.causeId);
    expect(after.body.next.some((n: any) => n.causeId === first.causeId)).toBe(false);
  });

  it('requires a value for measurement steps', async () => {
    const start = await request(http).post('/api/diagnostics/sessions').send({ variantId: golf20, codes: ['P0335'] }).expect(201);
    const first = start.body.next[0];
    const proc = (await request(http).get(`/api/test-procedures/${first.test.procedureId}`)).body;
    const r = await request(http).post(`/api/diagnostics/sessions/${start.body.id}/results`)
      .send({ causeId: first.causeId, steps: proc.steps.map((s: any) => ({ stepId: s.id, ok: true })) });
    if (proc.steps.some((s: any) => s.spec)) expect(r.status).toBe(400);
  });

  it('rejects unknown codes and more than 10 codes', async () => {
    const r = await request(http).post('/api/diagnostics/sessions').send({ variantId: golf20, codes: ['P9999'] }).expect(400);
    expect(r.body.unknown).toEqual(['P9999']);
    const codes = Array.from({ length: 11 }, (_, i) => `P01${String(i).padStart(2, '0')}`);
    await request(http).post('/api/diagnostics/sessions').send({ variantId: golf20, codes }).expect(400);
  });

  it('blocks HV tests until the isolation procedure is fully confirmed', async () => {
    const start = await request(http).post('/api/diagnostics/sessions').send({ variantId: yaris, codes: ['P0AA6'] }).expect(201);
    expect(start.body.hvRequired).toBe(true);
    const blocked = start.body.next.find((n: any) => n.blockedByHv);
    expect(blocked).toBeTruthy();
    const proc = (await request(http).get(`/api/test-procedures/${blocked.test.procedureId}`)).body;
    const steps = proc.steps.map((s: any) => ({ stepId: s.id, ok: true }));
    await request(http).post(`/api/diagnostics/sessions/${start.body.id}/results`).send({ causeId: blocked.causeId, steps }).expect(400);
    await request(http).post(`/api/diagnostics/sessions/${start.body.id}/hv-isolation`).send({ confirmedSteps: [0, 1] }).expect(400);
    const all = start.body.hvProcedure.steps.map((_: string, i: number) => i);
    const iso = await request(http).post(`/api/diagnostics/sessions/${start.body.id}/hv-isolation`).send({ confirmedSteps: all }).expect(201);
    expect(iso.body.hvIsolated).toBe(true);
    await request(http).post(`/api/diagnostics/sessions/${start.body.id}/results`).send({ causeId: blocked.causeId, steps }).expect(201);
  });

  it('returns TSBs and field cases for the codes', async () => {
    const dtcs = (await request(http).get(`/api/variants/${golf20}/dtcs`).query({ q: 'U01' })).body;
    const ids = dtcs.map((d: any) => d.id).join(',');
    const k = await request(http).get(`/api/variants/${golf20}/knowledge`).query({ dtcs: ids }).expect(200);
    expect(k.body.tsbs[0].number).toBe('DEMO-2019-07');
    expect(k.body.fieldCases.length).toBeGreaterThan(0);
  });
});

describe('labor & quotes', () => {
  it('deducts the shared teardown for timing belt + water pump', async () => {
    const ops = (await request(http).get(`/api/variants/${golf20}/labor-operations`)).body;
    const tb = ops.find((o: any) => o.code === 'TIMING_BELT_KIT').id;
    const wp = ops.find((o: any) => o.code === 'WATER_PUMP').id;
    const r = await request(http).post('/api/quotes/preview').send({ variantId: golf20, operationIds: [tb, wp], hourlyRateMillimes: 45000 }).expect(201);
    expect(r.body.grossHours).toBe(6.1);
    expect(r.body.netHours).toBe(3.7);
    expect(r.body.totalFormatted).toBe('166,500 DT');
  });
  it('applies an OEM overlap rule when one exists', async () => {
    const ops = (await request(http).get(`/api/variants/${golf20}/labor-operations`)).body;
    const pads = ops.find((o: any) => o.code === 'FRONT_PADS').id;
    const discs = ops.find((o: any) => o.code === 'FRONT_DISCS_PADS').id;
    const r = await request(http).post('/api/quotes/preview').send({ variantId: golf20, operationIds: [pads, discs], hourlyRateMillimes: 45000 }).expect(201);
    expect(r.body.method).toBe('oem_rules');
    expect(r.body.netHours).toBe(1.4);
  });
  it('rejects operations of another vehicle and renders a PDF', async () => {
    const yOps = (await request(http).get(`/api/variants/${yaris}/labor-operations`)).body;
    await request(http).post('/api/quotes/preview').send({ variantId: golf20, operationIds: [yOps[0].id], hourlyRateMillimes: 45000 }).expect(400);
    const ops = (await request(http).get(`/api/variants/${golf20}/labor-operations`)).body;
    const saved = await request(http).post('/api/quotes').send({ variantId: golf20, operationIds: [ops[0].id], hourlyRateMillimes: 40000 }).expect(201);
    const pdf = await request(http).get(saved.body.pdfUrl).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('wiring & maintenance', () => {
  it('traces a CAN-H wire across splices to every ECU', async () => {
    const d = (await request(http).get(`/api/variants/${golf20}/diagrams`)).body[0];
    const svg = await request(http).get(`/api/diagrams/${d.id}/svg`).expect(200);
    expect(svg.headers['content-type']).toMatch(/svg/);
    const text = svg.text || Buffer.from(svg.body).toString('utf8');
    const wireId = Number(/id="w-(\d+)"[^>]*data-color="or\/sw"/.exec(text)![1]);
    const t = await request(http).get(`/api/diagrams/${d.id}/trace`).query({ wire: wireId }).expect(200);
    expect(t.body.endpoints.map((e: any) => e.componentRef).sort()).toEqual(['J104', 'J533', 'J623', 'J743']);
  });
  it('computes due maintenance items', async () => {
    const r = await request(http).get(`/api/variants/${golf20}/maintenance`).query({ km: 89500, ageMonths: 70 }).expect(200);
    expect(r.body.items[0].status).toBe('due');
    const pdf = await request(http).get(`/api/variants/${golf20}/maintenance/checklist.pdf`).query({ km: 89500, ageMonths: 70 }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });
  it('validates ids', async () => {
    await request(http).get('/api/variants/abc').expect(400);
    await request(http).get('/api/variants/99999').expect(404);
    await request(http).get('/api/diagnostics/sessions/not-a-uuid').expect(400);
  });
});
