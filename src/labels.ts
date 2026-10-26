import fs from 'node:fs';
import path from 'node:path';
import { MercadoLivreClient } from './meli';
import { isLabelSent } from './db';
import { config } from './config';
import type { MercadoLivreOrder } from './types';

export interface PrintableShipment {
  orderId: string;
  shipmentId: number;
}

export interface GeneratedLabel extends PrintableShipment {
  filePath: string;
}

export interface PendingLabelsResult {
  totalPaidOrders: number;
  pending: PrintableShipment[];
  alreadySent: number;
  notReady: number;
  withoutShipping: number;
  errors: number;
}

/**
 * Mercado Livre only makes labels available while the shipment is
 * `ready_to_ship`; shipped/delivered shipments return NOT_PRINTABLE_STATUS.
 * Shipments already recorded in the local database are skipped.
 */
export async function collectPendingShipments(
  orders: MercadoLivreOrder[],
  meli: MercadoLivreClient = new MercadoLivreClient()
): Promise<PendingLabelsResult> {
  const pending: PrintableShipment[] = [];
  let alreadySent = 0;
  let notReady = 0;
  let withoutShipping = 0;
  let errors = 0;

  for (const order of orders) {
    const shipmentId = order.shipping?.id;
    if (!shipmentId) {
      withoutShipping++;
      continue;
    }
    if (await isLabelSent(shipmentId)) {
      alreadySent++;
      continue;
    }

    try {
      const status = await meli.fetchShipmentStatus(shipmentId);
      if (status === 'ready_to_ship') {
        pending.push({ orderId: order.id, shipmentId });
      } else {
        notReady++;
      }
    } catch (err) {
      errors++;
      console.log(
        `Failed to check shipment ${shipmentId} for order ${order.id}: ` +
          `${err instanceof Error ? err.message : err}`
      );
    }
  }

  return {
    totalPaidOrders: orders.length,
    pending,
    alreadySent,
    notReady,
    withoutShipping,
    errors,
  };
}

/**
 * Download one PDF per shipment so each label is a separate file.
 */
export async function generateLabelPdfs(
  shipments: PrintableShipment[],
  meli: MercadoLivreClient = new MercadoLivreClient()
): Promise<GeneratedLabel[]> {
  fs.mkdirSync(config.outputDir, { recursive: true });
  const labels: GeneratedLabel[] = [];

  for (const shipment of shipments) {
    try {
      const pdf = await meli.fetchShipmentLabels([shipment.shipmentId]);
      const safeOrderId = String(shipment.orderId).replace(/[^a-zA-Z0-9_-]/g, '');
      const filePath = path.join(
        config.outputDir,
        `label-${safeOrderId}-${shipment.shipmentId}.pdf`
      );
      fs.writeFileSync(filePath, pdf);
      labels.push({ ...shipment, filePath });
    } catch (err) {
      console.log(
        `Failed to download label for order ${shipment.orderId}: ` +
          `${err instanceof Error ? err.message : err}`
      );
    }
  }

  return labels;
}
