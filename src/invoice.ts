import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import type { InvoiceData } from './types';

function formatMoney(value: number, currency: string): string {
  const symbols: Record<string, string> = { BRL: 'R$', USD: 'US$', MXN: '$', COP: '$' };
  const symbol = symbols[currency] ?? currency;
  return `${symbol} ${value.toFixed(2)}`;
}

function formatDate(iso: string, timezone: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/**
 * Generate a simple invoice PDF for a single order and return the file path.
 */
export async function generateInvoice(invoice: InvoiceData): Promise<string> {
  fs.mkdirSync(config.outputDir, { recursive: true });

  const safeId = invoice.orderId.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(config.outputDir, `invoice-${safeId}.pdf`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Header
  doc.fontSize(20).fillColor('#009EE3').text('Fatura de Venda', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('black').text(`Pedido: ${invoice.orderId}`, { align: 'center' });
  doc.text(`Data: ${formatDate(invoice.date, config.timezone)}`, { align: 'center' });
  doc.moveDown(1.5);

  // Buyer
  doc.fontSize(12).text('Comprador');
  doc.moveDown(0.3);
  doc.fontSize(10);
  const buyerName = invoice.buyerName || invoice.buyerNickname || 'N/A';
  doc.text(`Nome: ${buyerName}`);
  doc.text(`Nickname: ${invoice.buyerNickname || '-'}`);
  doc.moveDown(1);

  // Items table
  doc.fontSize(12).text('Itens');
  doc.moveDown(0.3);

  const tableTop = doc.y;
  const col = {
    item: 60,
    qty: 60,
    unit: 100,
    subtotal: 120,
  };
  const tableWidth = 50 + col.item + col.qty + col.unit + col.subtotal;

  doc.fontSize(9).fillColor('#555555');
  const headers: [string, number][] = [
    ['Item', col.item],
    ['Qtd', col.qty],
    ['Preço Unit.', col.unit],
    ['Subtotal', col.subtotal],
  ];

  let x = 50;
  headers.forEach(([label, width]) => {
    doc.text(label, x, tableTop, { width, align: label === 'Item' ? 'left' : 'right' });
    x += width;
  });
  doc.fillColor('black');
  const lineY = tableTop + 14;
  doc.moveTo(50, lineY).lineTo(50 + tableWidth, lineY).stroke();

  let y = lineY + 8;
  invoice.items.forEach((item) => {
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
    doc.fontSize(9);
    doc.text(item.title, 50, y, { width: col.item, align: 'left' });
    doc.text(String(item.quantity), 50 + col.item, y, { width: col.qty, align: 'right' });
    doc.text(formatMoney(item.unitPrice, invoice.currency), 50 + col.item + col.qty, y, {
      width: col.unit,
      align: 'right',
    });
    doc.text(formatMoney(item.subtotal, invoice.currency), 50 + col.item + col.qty + col.unit, y, {
      width: col.subtotal,
      align: 'right',
    });
    y += 16;
  });

  // Total
  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(50 + tableWidth, doc.y).stroke();
  doc.moveDown(0.5);
  const totalLabelX = 50;
  const totalLabelWidth = col.item + col.qty + col.unit;
  doc.fontSize(14).fillColor('black');
  doc.text('Total:', totalLabelX, doc.y, { width: totalLabelWidth, align: 'right' });

  doc.fillColor('#009EE3');
  doc.text(
    formatMoney(invoice.totalAmount, invoice.currency),
    totalLabelX + totalLabelWidth,
    undefined,
    { width: col.subtotal, align: 'right' }
  );

  doc.fontSize(9).fillColor('black');
  doc.moveDown(3);
  doc.text(
    'Documento gerado automaticamente. Este não é um documento fiscal (NF-e).',
    { align: 'center' }
  );

  doc.end();

  return new Promise<string>((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}
