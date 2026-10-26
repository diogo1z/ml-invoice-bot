import { MercadoLivreClient, filterByDateAndStatus, toInvoiceData } from './meli';
import { generateInvoice } from './invoice';
import {
  sendFilesByEmail,
  sendInvoiceByEmail,
  sendTestEmail as sendSmtpTestEmail,
} from './email';
import { collectPendingShipments, generateLabelPdfs } from './labels';
import { markLabelsSent } from './db';
import { config } from './config';

function captionFor(totalAmount: number, currency: string, orderId: string): string {
  return `Fatura do pedido ${orderId}\nTotal: ${currency} ${totalAmount.toFixed(2)}`;
}

function clickToChatLink(phone: string, caption: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(caption)}`;
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

  const sendWhatsApp = config.deliveryMode === 'whatsapp' || config.deliveryMode === 'both';
  const sendEmail = config.deliveryMode === 'email' || config.deliveryMode === 'both';

  if (sendWhatsApp) {
    if (!config.whatsapp.useWeb) {
      console.log('WHATSAPP_MODE=click-to-chat: printing share links instead of sending.');
      if (config.fallbackNumbers.length === 0) {
        console.log('Set FALLBACK_NUMBERS to generate click-to-chat links.');
      } else {
        for (let i = 0; i < files.length; i++) {
          const order = recent[i];
          const caption = captionFor(order.total_amount, order.currency_id, order.id);
          for (const phone of config.fallbackNumbers) {
            console.log(`${order.id} (${phone}): ${clickToChatLink(phone, caption)}`);
          }
        }
      }
    } else {
      const { sendInvoiceToWhatsApp } = await import('./whatsapp.js');
      console.log('Connecting to WhatsApp...');
      for (let i = 0; i < files.length; i++) {
        const order = recent[i];
        await sendInvoiceToWhatsApp(
          files[i],
          captionFor(order.total_amount, order.currency_id, order.id)
        );
        console.log(`Sent invoice for order ${order.id} to WhatsApp`);
      }
    }
  }

  if (sendEmail) {
    console.log('Sending invoices via email...');
    for (let i = 0; i < files.length; i++) {
      const order = recent[i];
      await sendInvoiceByEmail(
        files[i],
        `Fatura do pedido ${order.id}`,
        captionFor(order.total_amount, order.currency_id, order.id)
      );
      console.log(`Emailed invoice for order ${order.id} to ${config.email.to.join(', ')}`);
    }
  }

  console.log(
    `Done. ${files.length} invoice(s) delivered (mode: ${config.deliveryMode}) from ${config.outputDir}\n`
  );
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
 * Send a test email to confirm the SMTP configuration works.
 */
export async function testEmailDelivery(): Promise<void> {
  const to = config.email.to.join(', ');
  console.log(`\nSending test email to ${to || '(no recipients configured)'}...`);
  await sendSmtpTestEmail();
  console.log('Test email sent.\n');
}

/**
 * Find paid orders whose shipments still need to be sent, download one PDF per
 * label and email them. Labels already recorded in the local SQLite database
 * are skipped, so the same label is never emailed twice.
 */
export async function sendLabelsByEmail(): Promise<void> {
  console.log('\nChecking Mercado Livre for paid orders with pending shipments...');
  const meli = new MercadoLivreClient();
  const orders = await meli.fetchPaidOrders(config.labelsMaxOrders);
  const result = await collectPendingShipments(orders, meli);

  console.log(`Paid orders checked: ${result.totalPaidOrders}`);
  console.log(`Already sent: ${result.alreadySent}`);
  console.log(`Not ready to ship: ${result.notReady}`);
  console.log(`Without shipping info: ${result.withoutShipping}`);
  if (result.errors > 0) {
    console.log(`Errors while checking shipments: ${result.errors}`);
  }
  console.log(`Orders still to ship: ${result.pending.length}`);

  if (result.pending.length === 0) {
    console.log('No new labels to send.\n');
    return;
  }

  console.log(`Downloading ${result.pending.length} label(s), one PDF per order...`);
  const labels = await generateLabelPdfs(result.pending, meli);
  if (labels.length === 0) {
    console.log('Could not generate any labels. Nothing sent.\n');
    return;
  }

  const to = config.email.labelsTo.join(', ');
  const orderIds = labels.map((label) => label.orderId).join(', ');
  const subject = `Etiquetas de envio - ${labels.length} pedido(s) para enviar`;
  const body = [
    `Pedidos a serem enviados: ${labels.length}`,
    `Pedidos: ${orderIds}`,
    '',
    'As etiquetas estão em anexo, uma por pedido.',
  ].join('\n');

  console.log(`Sending ${labels.length} separate label PDF(s) to ${to}...`);
  await sendFilesByEmail(
    labels.map((label) => label.filePath),
    subject,
    body,
    config.email.labelsTo
  );

  await markLabelsSent(
    labels.map((label) => ({
      shipmentId: label.shipmentId,
      orderId: label.orderId,
      labelFile: label.filePath,
      emailTo: to,
    }))
  );

  console.log(`Email sent. ${labels.length} label(s) marked as sent in the database.\n`);
}

/**
 * Print how many paid orders still have labels to be sent, without sending.
 */
export async function listPendingLabels(): Promise<void> {
  const meli = new MercadoLivreClient();
  const orders = await meli.fetchPaidOrders(config.labelsMaxOrders);
  const result = await collectPendingShipments(orders, meli);

  console.log('\nMercado Livre label status');
  console.log(`- Paid orders checked: ${result.totalPaidOrders}`);
  console.log(`- Already sent: ${result.alreadySent}`);
  console.log(`- Not ready to ship: ${result.notReady}`);
  console.log(`- Without shipping info: ${result.withoutShipping}`);
  if (result.errors > 0) {
    console.log(`- Errors while checking shipments: ${result.errors}`);
  }
  console.log(`- Orders still to ship: ${result.pending.length}`);
  for (const shipment of result.pending) {
    console.log(`  * order ${shipment.orderId} (shipment ${shipment.shipmentId})`);
  }
  console.log();
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

  const { getClient, getGroupInfo, resolveGroupId, sendTestMessage } = await import(
    './whatsapp.js'
  );
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