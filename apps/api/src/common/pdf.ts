import path from 'node:path';
import PDFDocument from 'pdfkit';
import { config } from '../config';

export const COLORS = { ink: '#16181d', muted: '#5b616e', accent: '#c8102e', line: '#d9dce1', soft: '#f3f4f6' };

export function newPdf(title: string): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: title, Author: 'AutoTech Knowledge Hub' } });
  doc.registerFont('regular', path.join(config.fontsDir, 'DejaVuSans.ttf'));
  doc.registerFont('bold', path.join(config.fontsDir, 'DejaVuSans-Bold.ttf'));
  doc.font('regular');
  return doc;
}

export function header(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.rect(0, 0, doc.page.width, 6).fill(COLORS.accent);
  doc.fillColor(COLORS.ink).font('bold').fontSize(18).text(title, 48, 32);
  doc.font('regular').fontSize(10).fillColor(COLORS.muted).text(subtitle);
  doc.moveDown(0.8);
}

export function demoNotice(doc: PDFKit.PDFDocument) {
  doc.moveDown(1);
  doc.font('regular').fontSize(8).fillColor(COLORS.muted).text(
    'Document généré avec des données de démonstration : temps et valeurs non contractuels, à remplacer par les données constructeur sous licence.',
    { width: doc.page.width - 96 },
  );
}

export function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Simple table helper: draws header + rows with fixed column widths, paginates. */
export function table(doc: PDFKit.PDFDocument, cols: { label: string; width: number; align?: 'left' | 'right' | 'center' }[], rows: string[][]) {
  const x0 = 48;
  const drawRow = (cells: string[], bold: boolean, fill?: string) => {
    const heights = cells.map((c, i) => doc.font(bold ? 'bold' : 'regular').fontSize(9).heightOfString(c, { width: cols[i]!.width - 8 }));
    const h = Math.max(...heights) + 8;
    if (doc.y + h > doc.page.height - 60) doc.addPage();
    const y = doc.y;
    if (fill) doc.rect(x0, y, cols.reduce((a, c) => a + c.width, 0), h).fill(fill);
    let x = x0;
    cells.forEach((c, i) => {
      doc.fillColor(bold && fill === COLORS.ink ? '#ffffff' : COLORS.ink).font(bold ? 'bold' : 'regular').fontSize(9)
        .text(c, x + 4, y + 4, { width: cols[i]!.width - 8, align: cols[i]!.align ?? 'left' });
      x += cols[i]!.width;
    });
    doc.moveTo(x0, y + h).lineTo(x, y + h).strokeColor(COLORS.line).lineWidth(0.5).stroke();
    doc.y = y + h;
  };
  drawRow(cols.map(c => c.label), true, COLORS.ink);
  rows.forEach((r, i) => drawRow(r, false, i % 2 ? COLORS.soft : undefined));
  doc.x = x0;
}
