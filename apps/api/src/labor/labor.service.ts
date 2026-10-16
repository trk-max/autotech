import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { computeQuote, formatTnd, laborPriceMillimes, validateStepGraph, type LaborOperation, type LaborStep, type OverlapRule } from '@autotech/engines';
import { DbService, applies } from '../db/db.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { config } from '../config';
import { domain } from '../common/errors.filter';
import { COLORS, demoNotice, header, newPdf, table, toBuffer } from '../common/pdf';

@Injectable()
export class LaborService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(VehiclesService) private readonly vehicles: VehiclesService,
  ) {}

  async operations(variantId: number) {
    return this.db.query(
      `SELECT o.id, o.code, o.name, o.system::text AS system, o.oem_hours AS "oemHours",
              array_agg(s.name ORDER BY s.id) AS steps
       FROM labor_operation o
       LEFT JOIN labor_operation_step os ON os.operation_id = o.id
       LEFT JOIN labor_step s ON s.id = os.step_id
       WHERE ${applies('o')} GROUP BY o.id ORDER BY o.system, o.name`, [variantId]);
  }

  private async graph(variantId: number) {
    const steps = await this.db.query(
      `SELECT s.id, s.code, s.name, s.hours, s.is_access AS "isAccess",
              coalesce(array_agg(d.requires_step_id) FILTER (WHERE d.requires_step_id IS NOT NULL), '{}') AS requires
       FROM labor_step s LEFT JOIN labor_step_dependency d ON d.step_id = s.id
       WHERE ${applies('s')} GROUP BY s.id`, [variantId]);
    const map = new Map<number, LaborStep>(steps.map(s => [s.id, { ...s, requires: s.requires.map(Number) }]));
    domain(() => validateStepGraph(map));
    return map;
  }

  async preview(variantId: number, operationIds: number[], hourlyRateMillimes: number) {
    const ops = await this.db.query(
      `SELECT o.id, o.code, o.name, o.oem_hours AS "oemHours", coalesce(array_agg(os.step_id) FILTER (WHERE os.step_id IS NOT NULL), '{}') AS "stepIds"
       FROM labor_operation o LEFT JOIN labor_operation_step os ON os.operation_id = o.id
       WHERE o.id = ANY($2) AND ${applies('o')} GROUP BY o.id`, [variantId, operationIds]);
    const missing = operationIds.filter(id => !ops.some(o => o.id === id));
    if (missing.length) throw new BadRequestException(`Opération(s) non applicable(s) à ce véhicule : ${missing.join(', ')}`);
    const ordered: LaborOperation[] = operationIds.map(id => {
      const o = ops.find(x => x.id === id)!;
      return { ...o, stepIds: o.stepIds.map(Number) };
    });
    const rules = await this.db.query<OverlapRule>(
      `SELECT op_a_id AS "opA", op_b_id AS "opB", deduct_hours AS "deductHours" FROM labor_overlap_rule WHERE op_a_id = ANY($1) AND op_b_id = ANY($1)`, [operationIds]);
    const graph = await this.graph(variantId);
    const q = domain(() => computeQuote(ordered, graph, rules));
    const total = laborPriceMillimes(q.netHours, hourlyRateMillimes);
    const grossTotal = laborPriceMillimes(q.grossHours, hourlyRateMillimes);
    return {
      ...q,
      hourlyRateMillimes,
      totalMillimes: total,
      savedMillimes: grossTotal - total,
      totalFormatted: formatTnd(total),
      savedFormatted: formatTnd(grossTotal - total),
      rateFormatted: formatTnd(hourlyRateMillimes),
    };
  }

  async save(variantId: number, operationIds: number[], hourlyRateMillimes: number, customerName: string | null) {
    const p = await this.preview(variantId, operationIds, hourlyRateMillimes);
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO quote (org_id, variant_id, operation_ids, gross_hours, net_hours, breakdown, hourly_rate_millimes, total_millimes, customer_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [config.demoOrgId, variantId, operationIds, p.grossHours, p.netHours, JSON.stringify(p), hourlyRateMillimes, p.totalMillimes, customerName]);
    return this.get(row!.id);
  }

  async get(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Devis introuvable');
    const q = await this.db.one(
      `SELECT id, variant_id AS "variantId", breakdown, customer_name AS "customerName", created_at AS "createdAt"
       FROM quote WHERE id = $1 AND org_id = $2`, [id, config.demoOrgId]);
    if (!q) throw new NotFoundException('Devis introuvable');
    return { id: q.id, variantId: q.variantId, customerName: q.customerName, createdAt: q.createdAt, ...q.breakdown, pdfUrl: `/api/quotes/${q.id}/pdf` };
  }

  async pdf(id: string): Promise<Buffer> {
    const q = await this.get(id);
    const v = await this.vehicles.variant(q.variantId);
    const doc = newPdf('Devis main-d\'œuvre');
    const date = new Date(q.createdAt).toLocaleDateString('fr-FR');
    header(doc, "Devis main-d'œuvre", `N° ${q.id.slice(0, 8).toUpperCase()} · ${date}${q.customerName ? ' · Client : ' + q.customerName : ''}`);
    doc.font('bold').fontSize(11).fillColor(COLORS.ink).text(v.label);
    doc.moveDown(0.8);

    doc.font('bold').fontSize(11).text('Opérations');
    doc.moveDown(0.3);
    table(doc, [
      { label: 'Code', width: 140 }, { label: 'Opération', width: 260 }, { label: 'Temps constructeur', width: 99, align: 'right' },
    ], q.operations.map((o: any) => [o.code, o.name, `${o.oemHours.toFixed(2)} h`]));
    doc.moveDown(1);

    if (q.lines.length) {
      doc.font('bold').fontSize(11).text('Détail des étapes (temps communs facturés une seule fois)');
      doc.moveDown(0.3);
      table(doc, [
        { label: 'Étape', width: 250 }, { label: 'Type', width: 70 }, { label: 'Partagée par', width: 120 }, { label: 'Temps', width: 59, align: 'right' },
      ], q.lines.map((l: any) => [l.name, l.isAccess ? 'Accès' : 'Travail', l.sharedBy.join(' + '), `${l.hours.toFixed(2)} h`]));
      doc.moveDown(1);
    } else if (q.method === 'oem_rules') {
      doc.font('regular').fontSize(9).fillColor(COLORS.muted).text('Recouvrement calculé selon la table de déduction du constructeur.');
      doc.moveDown(1);
    }

    const rows: [string, string][] = [
      ['Total temps constructeur (brut)', `${q.grossHours.toFixed(2)} h`],
      ['Temps évité (recouvrement)', `− ${q.savedHours.toFixed(2)} h`],
      ['Temps facturé', `${q.netHours.toFixed(2)} h`],
      ['Taux horaire', q.rateFormatted],
      ['Économie pour le client', q.savedFormatted],
    ];
    const bx = 287, bw = 260;
    if (doc.y > doc.page.height - 200) doc.addPage();
    let y = doc.y;
    for (const [k, val] of rows) {
      doc.font('regular').fontSize(10).fillColor(COLORS.ink).text(k, bx, y, { width: 170, lineBreak: false });
      doc.text(val, bx + 170, y, { width: bw - 170, align: 'right', lineBreak: false });
      y += 17;
    }
    y += 4;
    doc.rect(bx, y, bw, 30).fill(COLORS.ink);
    doc.fillColor('#ffffff').font('bold').fontSize(12).text("Total main-d'œuvre HT", bx + 10, y + 9, { width: 160, lineBreak: false });
    doc.text(q.totalFormatted, bx + 150, y + 9, { width: bw - 160, align: 'right', lineBreak: false });
    doc.x = 48;
    doc.y = y + 44;
    if (q.warnings.length) {
      doc.moveDown(0.5);
      doc.font('regular').fontSize(8).fillColor(COLORS.accent).text(q.warnings.join('\n'), 48, doc.y, { width: doc.page.width - 96 });
    }
    demoNotice(doc);
    return toBuffer(doc);
  }
}
