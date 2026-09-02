import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { runFullFlow, generateTestInvoice, listRecentOrders, setupWhatsApp } from './actions';

const rl = readline.createInterface({ input, output });

function printMenu(): void {
  console.log('\n=== Mercado Livre → Invoice → WhatsApp ===');
  console.log(' 1) Setup WhatsApp (link QR code, check group, test)');
  console.log(' 2) Run full flow (orders → invoices → send to group)');
  console.log(' 3) Generate test invoice (no ML keys needed)');
  console.log(' 4) List recent orders (needs ML keys)');
  console.log(' 5) Send a test invoice to the WhatsApp group');
  console.log(' 0) Exit');
}

async function main(): Promise<void> {
  while (true) {
    printMenu();
    let raw: string;
    try {
      raw = (await rl.question('\nSelect an option: ')).trim();
    } catch {
      console.log('\nBye!');
      rl.close();
      return;
    }
    const choice = raw.trim();

    if (choice === '0' || choice.toLowerCase() === 'exit') {
      console.log('Bye!');
      rl.close();
      return;
    }

    try {
      switch (choice) {
        case '1':
          await setupWhatsApp((q) => rl.question(q));
          break;
        case '2':
          await runFullFlow();
          break;
        case '3':
          await generateTestInvoice();
          break;
        case '4':
          await listRecentOrders();
          break;
        case '5': {
          const file = await generateTestInvoice();
          const answer = await rl.question('Send it to the WhatsApp group now? (y/n): ');
          if (answer.trim().toLowerCase().startsWith('y')) {
            console.log('Connecting to WhatsApp...');
            await sendTestInvoice(file);
            console.log('Test invoice sent to the group.\n');
          } else {
            console.log('Skipped. The PDF is saved locally: ' + file + '\n');
          }
          break;
        }
        default:
          console.log(`Unknown option "${choice}". Try again.`);
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err, '\n');
    }
  }
}

async function sendTestInvoice(file: string): Promise<void> {
  const { sendInvoiceToWhatsApp } = await import('./whatsapp.js');
  await sendInvoiceToWhatsApp(file, 'Fatura de teste gerada automaticamente.');
}

main();