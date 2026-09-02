import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { config } from './config';

let client: Client | undefined;

/**
 * Initialize the whatsapp-web.js client. On first run a QR code is printed to
 * the terminal which must be scanned from the phone (WhatsApp > Settings >
 * Linked devices). The session is persisted in the session dir so later runs
 * don't need the QR again.
 */
export async function getClient(): Promise<Client> {
  if (client) return client;
  if (!config.whatsapp.useWeb) {
    throw new Error('WhatsApp Web mode is disabled in config.');
  }

  client = new Client({
    authStrategy: new LocalAuth({ clientId: 'ml-invoice', dataPath: config.whatsapp.sessionDir }),
    puppeteer: { headless: true },
  });

  const readyPromise = new Promise<void>((resolve) => {
    client!.on('qr', (qr) => {
      console.log('Scan this QR code with your phone to link WhatsApp:');
      qrcode.generate(qr, { small: true });
    });

    client!.on('ready', () => {
      console.log('WhatsApp client is ready.');
      resolve();
    });

    client!.on('disconnected', (reason) => {
      console.log('WhatsApp client disconnected:', reason);
      client = undefined;
    });
  });

  await client.initialize();
  await readyPromise;
  return client;
}

export async function resolveGroupId(client: Client): Promise<string | undefined> {
  if (config.whatsapp.groupId) return config.whatsapp.groupId;
  if (config.whatsapp.groupName) {
    const chats = await client.getChats();
    const group = chats.find((c: any) => c.isGroup && c.name === config.whatsapp.groupName);
    if (group) return group.id._serialized;
  }
  return undefined;
}

/**
 * Send an invoice (media) to the configured WhatsApp group.
 */
export async function sendInvoiceToWhatsApp(filePath: string, caption: string): Promise<string> {
  const waClient = await getClient();
  const groupId = await resolveGroupId(waClient);
  if (!groupId) {
    throw new Error(
      'WhatsApp group not found. Set WHATSAPP_GROUP_ID (e.g. "123456789@g.us") or WHATSAPP_GROUP_NAME.'
    );
  }
  const media = MessageMedia.fromFilePath(filePath);
  const message = await waClient.sendMessage(groupId, media, { caption });
  return message.id._serialized;
}

/**
 * Fallback that prints a click-to-chat link so the invoice media can be sent
 * manually from a browser/phone when the Web session is unavailable.
 */
export function printClickToChatFallback(phone: string, caption: string): string {
  const text = encodeURIComponent(caption);
  return `https://wa.me/${phone}?text=${text}`;
}

/**
 * Look up a group chat by id and return its display info.
 */
export async function getGroupInfo(groupId: string): Promise<{ name: string }> {
  const chat = await getClient().then((c) => c.getChatById(groupId));
  return { name: chat.name };
}

/**
 * Send a plain text test message to the configured group to confirm the
 * connection and group resolution work.
 */
export async function sendTestMessage(text: string): Promise<string> {
  const waClient = await getClient();
  const groupId = await resolveGroupId(waClient);
  if (!groupId) {
    throw new Error(
      'WhatsApp group not found. Set WHATSAPP_GROUP_ID (e.g. "123456789@g.us") or WHATSAPP_GROUP_NAME.'
    );
  }
  const message = await waClient.sendMessage(groupId, text);
  return message.id._serialized;
}
