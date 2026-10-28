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
      // Get full shipment to check substatus (invoice_pending blocks printing)
      const shipment: any = await (meli as any).getShipment
        ? await (meli as any).getShipment(shipmentId)
        : null;

      const status = shipment?.status ?? (await meli.fetchShipmentStatus(shipmentId));
      const substatus = shipment?.substatus;

      if (status === 'ready_to_ship') {
        if (substatus === 'invoice_pending') {
          const orderIdStr = String(order.id);
          console.log(
            `Shipment ${shipmentId} (order ${orderIdStr}) is ready_to_ship but substatus invoice_pending. Requesting DC-e and label generation (will be sent on next run).`
          );

          // FLUXO 1: solicitar geração/declaração agora, sem bloquear
          try {
            if (typeof (meli as any).emitContentDeclaration === 'function') {
              await (meli as any).emitContentDeclaration(orderIdStr);
            } else if (typeof (meli as any).emitContentDeclarationByShipment === 'function') {
              await (meli as any).emitContentDeclarationByShipment(shipmentId);
            }
          } catch (err) {
            console.log(
              `Failed to request DC-e for order ${orderIdStr}: ${
                err instanceof Error ? err.message : err
              }`
            );
          }

          try {
            if (typeof (meli as any).requestLabelGeneration === 'function') {
              await (meli as any).requestLabelGeneration(shipmentId);
            }
          } catch (err) {
            console.log(
              `Failed to request label generation for shipment ${shipmentId}: ${
                err instanceof Error ? err.message : err
              }`
            );
          }

          notReady++;
          continue;
        }

        // Pronto para baixar e enviar nesta execução
        pending.push({ orderId: String(order.id), shipmentId });
        continue;
      }

      if (status === 'invoice_pending' || status === 'handling') {
        const orderIdStr = String(order.id);
        console.log(
          `Shipment ${shipmentId} (order ${orderIdStr}) status ${status}. Requesting DC-e and label generation (will be sent on next run).`
        );

        try {
          if (typeof (meli as any).emitContentDeclaration === 'function') {
            await (meli as any).emitContentDeclaration(orderIdStr);
          } else if (typeof (meli as any).emitContentDeclarationByShipment === 'function') {
            await (meli as any).emitContentDeclarationByShipment(shipmentId);
          }
        } catch (err) {
          console.log(
            `Failed to request DC-e for order ${orderIdStr}: ${
              err instanceof Error ? err.message : err
            }`
          );
        }

        try {
          if (typeof (meli as any).requestLabelGeneration === 'function') {
            await (meli as any).requestLabelGeneration(shipmentId);
          }
        } catch (err) {
          console.log(
            `Failed to request label generation for shipment ${shipmentId}: ${
              err instanceof Error ? err.message : err
            }`
          );
        }

        notReady++;
        continue;
      }

      notReady++;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download one PDF per shipment so each label is a separate file.
 * If the label isn't printable yet (e.g. invoice_pending), request generation
 * and retry a few times in the same run.
 */
export async function generateLabelPdfs(
  shipments: PrintableShipment[],
  meli: MercadoLivreClient = new MercadoLivreClient()
): Promise<GeneratedLabel[]> {
  fs.mkdirSync(config.outputDir, { recursive: true });
  const labels: GeneratedLabel[] = [];

  for (const shipment of shipments) {
    try {
      // Try to emit content declaration first (DC-e via order)
      try {
        if (typeof (meli as any).emitContentDeclaration === 'function') {
          await (meli as any).emitContentDeclaration(shipment.orderId);
        } else if (typeof (meli as any).emitContentDeclarationByShipment === 'function') {
          await (meli as any).emitContentDeclarationByShipment(shipment.shipmentId);
        }
      } catch (err) {
        console.log(
          `Content declaration attempt for order ${shipment.orderId} failed: ${
            err instanceof Error ? err.message : err
          }`
        );
      }

      const pdf = await meli.fetchShipmentLabels([shipment.shipmentId]);
      const safeOrderId = String(shipment.orderId).replace(/[^a-zA-Z0-9_-]/g, '');
      const filePath = path.join(
        config.outputDir,
        `label-${safeOrderId}-${shipment.shipmentId}.pdf`
      );
      fs.writeFileSync(filePath, pdf);
      labels.push({ ...shipment, filePath });

      // Try to also download content declaration and save alongside if available
            try {
              if (typeof (meli as any).fetchContentDeclaration === 'function') {
                const decl = await (meli as any).fetchContentDeclaration(shipment.orderId);
                if (decl) {
                  const declPath = path.join(
                    config.outputDir,
                    `declaracao-conteudo-${safeOrderId}-${shipment.orderId}.pdf`
                  );
                  fs.writeFileSync(declPath, decl);
                  console.log(`Content declaration saved: ${path.basename(declPath)}`);
                }
              }
            } catch {}
      continue;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `Failed to download label for order ${shipment.orderId}: ${msg}`
      );

      if (
        msg.includes('NOT_PRINTABLE_STATUS') ||
        msg.includes('invoice_pending') ||
        msg.includes('SHPLAB0200')
      ) {
        console.log(
          `Requesting label generation for shipment ${shipment.shipmentId} (order ${shipment.orderId})...`
        );
        try {
          await meli.requestLabelGeneration(shipment.shipmentId);
        } catch (genErr) {
          console.log(
            `Failed to request label generation for shipment ${shipment.shipmentId}: ${
              genErr instanceof Error ? genErr.message : genErr
            }`
          );
        }

        // Try again in the same run - ML can generate quickly after emitting content declaration
        const delays = [5000, 8000, 10000, 15000, 20000, 30000];
        for (let i = 0; i < delays.length; i++) {
          console.log(`Waiting ${delays[i] / 1000}s before retrying label download...`);
          await sleep(delays[i]);
          try {
            try {
              if (typeof (meli as any).emitContentDeclaration === 'function') {
                await (meli as any).emitContentDeclaration(shipment.orderId);
              } else if (typeof (meli as any).emitContentDeclarationByShipment === 'function') {
                await (meli as any).emitContentDeclarationByShipment(shipment.shipmentId);
              }
            } catch (err) {
              console.log(
                `Content declaration attempt for order ${shipment.orderId} failed: ${
                  err instanceof Error ? err.message : err
                }`
              );
            }
            try {
              // refresh shipment to trigger internal processing
              await (meli as any).getShipment?.(shipment.shipmentId);
            } catch {}
            const pdf = await meli.fetchShipmentLabels([shipment.shipmentId]);
            const safeOrderId = String(shipment.orderId).replace(/[^a-zA-Z0-9_-]/g, '');
            const filePath = path.join(
              config.outputDir,
              `label-${safeOrderId}-${shipment.shipmentId}.pdf`
            );
            fs.writeFileSync(filePath, pdf);
            labels.push({ ...shipment, filePath });
            console.log(`Label downloaded for order ${shipment.orderId} after retry.`);

            try {
              if (typeof (meli as any).fetchContentDeclaration === 'function') {
                // Try order-based first
                const decl = await (meli as any).fetchContentDeclaration(shipment.orderId);
                if (decl) {
                  const declPath = path.join(
                    config.outputDir,
                    `declaracao-conteudo-${safeOrderId}-${shipment.orderId}.pdf`
                  );
                  fs.writeFileSync(declPath, decl);
                  console.log(`Content declaration saved: ${path.basename(declPath)}`);
                }
              } else if (typeof (meli as any).fetchContentDeclaration === 'function') {
                const decl = await (meli as any).fetchContentDeclaration([shipment.shipmentId]);
                if (decl) {
                  const declPath = path.join(
                    config.outputDir,
                    `declaracao-conteudo-${safeOrderId}-${shipment.shipmentId}.pdf`
                  );
                  fs.writeFileSync(declPath, decl);
                  console.log(`Content declaration saved: ${path.basename(declPath)}`);
                }
              }
            } catch {}
            break;
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            if (retryMsg.includes('invoice_pending') || retryMsg.includes('NOT_PRINTABLE_STATUS')) {
              continue;
            }
            console.log(
              `Retry failed for order ${shipment.orderId}: ${retryMsg}`
            );
            break;
          }
        }
      }
    }
  }

  return labels;
}
