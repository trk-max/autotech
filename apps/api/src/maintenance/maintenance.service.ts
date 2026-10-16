import { Inject, Injectable } from '@nestjs/common';
import { computeDueItems, type MaintenanceItemInput } from '@autotech/engines';
import { DbService, applies } from '../db/db.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { COLORS, demoNotice, header, newPdf, toBuffer } from '../common/pdf';

const STATUS_LABEL = { overdue: 'En retard', due: 'À faire', upcoming: 'Bientôt', ok: 'OK' } as const;

const STANDARD_CHECKS = [
  'Niveaux : liquide de refroidissement, frein, lave-glace, direction',
  'Pneumatiques : pression, usure, état des flancs (roue de secours incluse)',
  'Freinage : épaisseur plaquettes/disques, flexibles, fuites',
  'Éclairage et signalisation : feux, clignotants, avertisseur',
  'Essuie-glaces et pare-brise',
  'Train avant : rotules, silentblocs, soufflets de transmission',
  'Échappement : fixations, fuites',
  'Batterie : état, fixation, test',
  'Lecture des codes défaut (tous calculateurs)',
];

@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(VehiclesService) private readonly vehicles: VehiclesService,
  ) {}

  async schedule(variantId: number, km: number, ageMonths: number) {
    const items = await this.db.query(
      `SELECT i.id, i.task, i.interval_km AS "intervalKm", i.interval_months AS "intervalMonths",
              i.first_at_km AS "firstAtKm", i.first_at_months AS "firstAtMonths", i.whichever_first AS "whicheverFirst",
              i.operation_id AS "operationId", o.oem_hours AS "oemHours", ms.regime
       FROM maintenance_schedule ms JOIN maintenance_item i ON i.schedule_id = ms.id
       LEFT JOIN labor_operation o ON o.id = i.operation_id
       WHERE ${applies('ms')} ORDER BY i.id`, [variantId]);
    const due = computeDueItems(items as MaintenanceItemInput[], { km, ageMonths });
    const byId = new Map(items.map(i => [i.id, i]));
    return {
      km, ageMonths,
      items: due.map(d => {
        const i = byId.get(d.id)!;
        return { ...d, statusLabel: STATUS_LABEL[d.status], intervalKm: i.intervalKm, intervalMonths: i.intervalMonths, operationId: i.operationId, oemHours: i.oemHours, regime: i.regime };
      }),
    };
  }

  async checklistPdf(variantId: number, km: number, ageMonths: number, plate: string | null): Promise<Buffer> {
    const v = await this.vehicles.variant(variantId);
    const s = await this.schedule(variantId, km, ageMonths);
    const doc = newPdf("Fiche d'entretien");
    header(doc, "Fiche d'entretien", `${new Date().toLocaleDateString('fr-FR')} · ${km.toLocaleString('fr-FR')} km · ${ageMonths} mois${plate ? ' · ' + plate : ''}`);
    doc.font('bold').fontSize(11).fillColor(COLORS.ink).text(v.label);
    doc.moveDown(0.8);

    const box = (label: string, detail: string, color = COLORS.ink) => {
      if (doc.y > doc.page.height - 80) doc.addPage();
      const y = doc.y;
      doc.rect(48, y + 1, 10, 10).lineWidth(0.8).strokeColor(COLORS.ink).stroke();
      doc.font('regular').fontSize(10).fillColor(color).text(label, 66, y, { width: 330 });
      const h = doc.y - y;
      doc.fontSize(8).fillColor(COLORS.muted).text(detail, 400, y + 1, { width: 147, align: 'right' });
      doc.y = y + Math.max(h, 14) + 4;
      doc.x = 48;
    };

    doc.font('bold').fontSize(11).fillColor(COLORS.ink).text('Opérations du plan constructeur');
    doc.moveDown(0.4);
    const toDo = s.items.filter(i => i.status === 'overdue' || i.status === 'due');
    const soon = s.items.filter(i => i.status === 'upcoming');
    if (!toDo.length) doc.font('regular').fontSize(9).fillColor(COLORS.muted).text('Aucune opération échue à ce kilométrage.').moveDown(0.4);
    for (const i of toDo) {
      box(`${i.task}${i.status === 'overdue' ? '  (EN RETARD)' : ''}`,
        [i.intervalKm ? `${i.intervalKm.toLocaleString('fr-FR')} km` : null, i.intervalMonths ? `${i.intervalMonths} mois` : null].filter(Boolean).join(' / '),
        i.status === 'overdue' ? COLORS.accent : COLORS.ink);
    }
    if (soon.length) {
      doc.moveDown(0.6);
      doc.font('bold').fontSize(10).fillColor(COLORS.ink).text('À prévoir prochainement');
      doc.moveDown(0.3);
      for (const i of soon) {
        box(i.task, i.remainingKm != null && (i.remainingMonths == null || i.remainingKm < i.remainingMonths * 1500)
          ? `dans ${i.remainingKm.toLocaleString('fr-FR')} km` : `dans ${i.remainingMonths} mois`);
      }
    }
    doc.moveDown(0.8);
    doc.font('bold').fontSize(11).fillColor(COLORS.ink).text('Contrôles systématiques');
    doc.moveDown(0.4);
    for (const c of STANDARD_CHECKS) box(c, 'OK / À reprendre');
    doc.moveDown(1);
    doc.font('regular').fontSize(9).fillColor(COLORS.ink).text('Technicien : ____________________     Signature : ____________________');
    demoNotice(doc);
    return toBuffer(doc);
  }
}
