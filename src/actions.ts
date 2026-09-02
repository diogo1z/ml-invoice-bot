import fs from 'node:fs';
import path from 'node:path';
import { MercadoLivreClient, filterByDateAndStatus, toInvoiceData } from './meli';
import { generateInvoice } from './invoice';
import { getClient, getGroupInfo, resolveGroupId, sendInvoiceToWhatsApp, sendTestMessage } from './whatsapp';
import { config } from './config';

function captionFor(totalAmount: number, currency: string, orderId: string): string {
  return `Fatura do pedido ${orderId}\nTotal: ${currency} ${totalAmount.toFixed(2)}`;
}

/**
 * Full flow: fetch orders from ML, generate PDFs, send to the WhatsApp group.
 */
export async function runFullFlow(): Promise<void> {
  console.log('\nFetching recent sold orders from Mercado Livre...');
  const meli = new MercadoLivreClient();
  const orders = await meli.fetchSellerOrders(50);
  const recent = filterByDateAndStatus(orders, config.ordersDays, config.statuses);
  console.log(
    `Found ${recent.length} eligible order(s) in the last ${config.ordersDays} day(s) ` +
      `(statuses: ${config.statuses.join(', ')}, limit 50).`
  );

  if (recent.length === 0) {
    console.log('Nothing to send.\n');
    return;
  }

  const files: string[] = [];
  for (const order of recent) {
    const invoice = toInvoiceData(order);
    console.log(`Generating invoice for order ${order.id}...`);
    files.push(await generateInvoice(invoice));
  }

  if (!config.whatsapp.useWeb) {
    console.log('WHATSAPP_MODE=click-to-chat: printing share links instead of sending.\n');
    return;
  }

  console.log('Connecting to WhatsApp...');
  for (let i = 0; i < files.length; i++) {
    const order = recent[i];
    await sendInvoiceToWhatsApp(
      files[i],
      captionFor(order.total_amount, order.currency_id, order.id)
    );
    console.log(`Sent invoice for order ${order.id}`);
  }
  console.log(`Done. ${files.length} invoice(s) sent from ${config.outputDir}\n`);
}

/**
 * Generate a sample invoice PDF without needing ML keys, so the layout can be
 * checked and WhatsApp delivery can be tested.
 */
export async function generateTestInvoice(): Promise<string> {
  const file = await generateInvoice({
    orderId: 'TESTE-123',
    date: new Date().toISOString(),
    currency: 'BRL',
    totalAmount: 149.9,
    buyerName: 'Comprador de Teste',
    buyerNickname: 'TEST_BUYER',
    items: [
      { title: 'Camiseta preta M', quantity: 2, unitPrice: 59.95, subtotal: 119.9 },
      { title: 'Meia branca', quantity: 3, unitPrice: 10.0, subtotal: 30.0 },
    ],
  });
  console.log(`Test invoice generated: ${file}\n`);
  return file;
}

/**
 * List the most recent orders from Mercado Livre (needs a valid token).
 */
export async function listRecentOrders(): Promise<void> {
  const meli = new MercadoLivreClient();
  const orders = await meli.fetchSellerOrders(20);
  console.log(`\nLast ${orders.length} orders:`);
  for (const o of orders) {
    console.log(
      `- ${o.id} | ${o.status} | ${o.currency_id} ${o.total_amount.toFixed(2)} | ` +
        `${o.date_closed ?? o.date_created} | buyer=${o.buyer?.nickname ?? '?'}`
    );
  }
  console.log('\n');
}

/**
 * Link the WhatsApp session (QR on first run) and confirm the target group is
 * reachable, optionally sending a test message.
 */
export async function setupWhatsApp(ask: (q: string) => Promise<string>): Promise<void> {
  console.log('\nConnecting WhatsApp...');
  console.log('If a QR code appears, scan it with your phone:');
  console.log('  WhatsApp > Settings (gear) > Linked devices > Link a device\n');

  const waClient = await getClient();
  console.log('WhatsApp is linked and ready.\n');

  const groupId = await resolveGroupId(waClient);
  if (groupId) {
    const info = await getGroupInfo(groupId);
    console.log(`Target group found: "${info.name}" (${groupId})\n`);
  } else {
    console.log(
      'WARNING: target group NOT found. Set WHATSAPP_GROUP_NAME or WHATSAPP_GROUP_ID in .env.\n'
    );
    return;
  }

  const answer = (await ask('Send a test message to the group? (y/n): ')).trim().toLowerCase();
  if (answer === 'y' || answer === 'yes') {
    const id = await sendTestMessage('Teste de conexão do bot de faturas.');
    console.log(`Test message sent (id: ${id})\n`);
  } else {
    console.log('Skipped test message.\n');
  }
}