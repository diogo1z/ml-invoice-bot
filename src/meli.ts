import { config } from './config';
import type { MercadoLivreOrder } from './types';

const MELI_API = 'https://api.mercadolibre.com';
const MELI_AUTH = 'https://api.mercadolibre.com/oauth/token';

export function normalizeOrder(order: MercadoLivreOrder): MercadoLivreOrder {
  // The API may return order ids as numbers; normalize them to strings.
  return { ...order, id: String(order.id) };
}

export class MercadoLivreClient {
  private accessToken = config.meli.accessToken;

  /**
   * ML access tokens expire after 6 hours. A token is obtained using, in order:
   *  - a configured MELI_ACCESS_TOKEN (used as-is)
   *  - the refresh_token grant, when app credentials + refresh token are set
   *  - the client_credentials grant, when only app id + secret are set
   */
  async ensureToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;

    const { appId, appSecret, refreshToken } = config.meli;

    if (appId && appSecret && refreshToken) {
      return this.requestToken({
        grant_type: 'refresh_token',
        client_id: appId,
        client_secret: appSecret,
        refresh_token: refreshToken,
      });
    }

    if (appId && appSecret) {
      return this.requestToken({
        grant_type: 'client_credentials',
        client_id: appId,
        client_secret: appSecret,
      });
    }

    throw new Error(
      'No Mercado Livre credentials configured. Set MELI_ACCESS_TOKEN or MELI_APP_ID + MELI_APP_SECRET (optionally with MELI_REFRESH_TOKEN).'
    );
  }

  private async requestToken(params: Record<string, string>): Promise<string> {
    const res = await fetch(MELI_AUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    if (!res.ok) {
      throw new Error(`Failed to obtain ML token: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { access_token: string };
    this.accessToken = data.access_token;
    console.log('Obtained Mercado Livre access token.');
    return this.accessToken;
  }

  private async request<T>(path: string, retry = true): Promise<T> {
    const token = await this.ensureToken();
    const res = await fetch(`${MELI_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      // Token may be expired; drop it and retry once if we can get a new one.
      this.accessToken = undefined;
      if (retry && config.meli.appId && config.meli.appSecret) {
        return this.request<T>(path, false);
      }
      throw new Error('Unauthorized (401). Check/refresh your Mercado Livre credentials.');
    }
    if (!res.ok) {
      throw new Error(`Mercado Livre API error ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Fetch orders (sales) for the current seller. By default this returns the
   * authenticated user's seller orders. `limit`/`offset` support pagination.
   */
  async fetchSellerOrders(limit = 20, offset = 0): Promise<MercadoLivreOrder[]> {
    const me = await this.request<{ id: number }>('/users/me');
    const data = await this.request<{ results: MercadoLivreOrder[] }>(
      `/orders/search?seller=${me.id}&sort=date_desc&limit=${limit}&offset=${offset}`
    );
    return data.results.map(normalizeOrder);
  }

  /**
   * Fetch paid orders (newest first) with pagination, so pending shipments can
   * be found even when the order is older than the initial page.
   */
  async fetchPaidOrders(max = 300): Promise<MercadoLivreOrder[]> {
    const me = await this.request<{ id: number }>('/users/me');
    const pageSize = 50;
    const all: MercadoLivreOrder[] = [];

    for (let offset = 0; offset < max; offset += pageSize) {
      const data = await this.request<{ results: MercadoLivreOrder[] }>(
        `/orders/search?seller=${me.id}&order.status=paid&sort=date_desc` +
          `&limit=${pageSize}&offset=${offset}`
      );
      all.push(...data.results.map(normalizeOrder));
      if (data.results.length < pageSize) break;
    }

    return all.slice(0, max);
  }

  /**
   * Fetch a shipment's current status. Mercado Livre only re-issues labels for
   * shipments that are still `ready_to_ship`.
   */
  async fetchShipmentStatus(shipmentId: number): Promise<string> {
    const shipment = await this.request<{ status: string }>(`/shipments/${shipmentId}`);
    return shipment.status;
  }

  /**
   * Download the shipping labels for one or more shipments as a single PDF.
   */
  async fetchShipmentLabels(shipmentIds: number[]): Promise<Buffer> {
    if (shipmentIds.length === 0) {
      throw new Error('No shipment ids provided.');
    }
    const token = await this.ensureToken();
    const res = await fetch(
      `${MELI_API}/shipment_labels?shipment_ids=${shipmentIds.join(',')}&response_type=pdf`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      throw new Error(`Mercado Livre label error ${res.status}: ${await res.text()}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Download content declaration (declaração de conteúdo) for shipments if available.
   */
  async fetchContentDeclaration(shipmentIds: number[]): Promise<Buffer | null> {
    if (shipmentIds.length === 0) return null;
    const token = await this.ensureToken();

    const urls = [
      `${MELI_API}/shipment_labels?shipment_ids=${shipmentIds.join(',')}&response_type=pdf&document_type=content_declaration`,
      `${MELI_API}/shipments/${shipmentIds[0]}/content-declaration?format=pdf`,
      `${MELI_API}/shipments/${shipmentIds[0]}/documents/content-declaration/pdf`,
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 1000) return buf;
        }
      } catch {}
    }
    return null;
  }

  async getShipment(shipmentId: number): Promise<any> {
    return this.request<any>(`/shipments/${shipmentId}`);
  }

  /**
   * Emit "Declaração de Conteúdo" for shipments that require it.
   * In Mercado Livre app this appears as "Emitir declaração de conteúdo".
   */
  async emitContentDeclaration(orderId: string): Promise<void> {
    const token = await this.ensureToken();

    const url = `${MELI_API}/mlb/order/${encodeURIComponent(orderId)}/dce/emission`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const body = await res.text();

    if (res.status === 409 || res.status === 422) {
      console.log(
        `DC-e emission already in progress or not applicable for order ${orderId} (${res.status})`
      );
      return;
    }

    if (!res.ok) {
      throw new Error(`DC-e emission failed (${res.status}): ${body}`);
    }

    console.log(`DC-e emission started for order ${orderId}`);
  }

  async fetchContentDeclaration(orderId: string): Promise<Buffer | null> {
    const token = await this.ensureToken();

    const infoUrl = `${MELI_API}/mlb/order/${encodeURIComponent(orderId)}/dce/info`;
    const infoRes = await fetch(infoUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (infoRes.status === 404) {
      return null;
    }

    if (!infoRes.ok) {
      throw new Error(`DC-e status failed (${infoRes.status}): ${await infoRes.text()}`);
    }

    const info = (await infoRes.json()) as {
      status?: string;
      documents?: Array<{
        dce_key: string;
        document_type?: string;
        status?: string;
      }>;
    };

    if (info.status && info.status !== 'completed' && info.status !== 'COVERED') {
      console.log(`DC-e for order ${orderId} is not ready: ${info.status}`);
      return null;
    }

    const document = info.documents?.find(
      (doc) =>
        (doc.document_type === 'DCE' || doc.document_type === 'CONTENT_DECLARATION') &&
        (doc.status === 'issued' || doc.status === 'authorized' || doc.status === 'completed' || doc.status === 'COVERED')
    ) || info.documents?.find(
      (doc) => doc.status === 'issued' || doc.status === 'authorized' || doc.status === 'completed'
    );

    if (!document || !document.dce_key) {
      console.log(`No issued DC-e found for order ${orderId}`);
      return null;
    }

    const downloadUrl =
      `${MELI_API}/mlb/order/${encodeURIComponent(orderId)}/dce/info/${encodeURIComponent(
        document.dce_key
      )}?doctype=pdf`;

    const pdfRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!pdfRes.ok) {
      throw new Error(`DC-e download failed (${pdfRes.status}): ${await pdfRes.text()}`);
    }

    return Buffer.from(await pdfRes.arrayBuffer());
  }

  // Keep backward compatibility
  async emitContentDeclarationByShipment(shipmentId: number): Promise<void> {
    try {
      const shipment = await this.getShipment(shipmentId);
      if (shipment?.order_id) {
        await this.emitContentDeclaration(String(shipment.order_id));
      }
    } catch (err) {
      console.log(
        `Could not emit content declaration for shipment ${shipmentId}: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  /**
   * Request Mercado Livre to generate/print the label for a shipment.
   * For shipments in `invoice_pending`, try to force generation via multiple approaches.
   */
  async requestLabelGeneration(shipmentId: number): Promise<void> {
    const token = await this.ensureToken();
    const headersJson = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // Emit content declaration first if needed
    await this.emitContentDeclaration(shipmentId);
    await new Promise((r) => setTimeout(r, 2000));

    const attempts: Array<() => Promise<void>> = [
      async () => {
        const res = await fetch(`${MELI_API}/shipment_labels?shipment_ids=${shipmentId}&response_type=pdf`, {
          method: 'POST',
          headers: headersJson,
          body: JSON.stringify({}),
        });
        if (res.ok) {
          console.log(`Label generation requested via POST /shipment_labels?shipment_ids=...`);
          return;
        }
      },
      async () => {
        const res = await fetch(`${MELI_API}/shipment_labels`, {
          method: 'POST',
          headers: headersJson,
          body: JSON.stringify({
            shipment_ids: [shipmentId],
            response_type: 'pdf',
            print_format: 'A4',
          }),
        });
        if (res.ok) {
          console.log(`Label generation requested via POST /shipment_labels (with print_format)`);
          return;
        }
        const t = await res.text().catch(() => '');
        if (res.status === 409 || res.status === 422) {
          console.log(`Label generation already requested/in progress (${res.status})`);
          return;
        }
      },
      async () => {
        const res = await fetch(`${MELI_API}/shipments/${shipmentId}/labels`, {
          method: 'POST',
          headers: headersJson,
          body: JSON.stringify({ response_type: 'pdf', format: 'pdf', print_format: 'A4' }),
        });
        if (res.ok) {
          console.log(`Label generation requested via POST /shipments/${shipmentId}/labels`);
          return;
        }
      },
      async () => {
        const res = await fetch(`${MELI_API}/shipments/${shipmentId}/label`, {
          method: 'POST',
          headers: headersJson,
          body: JSON.stringify({ response_type: 'pdf' }),
        });
        if (res.ok) {
          console.log(`Label generation requested via POST /shipments/${shipmentId}/label`);
          return;
        }
      },
      async () => {
        const res = await fetch(`${MELI_API}/shipment_labels/generate`, {
          method: 'POST',
          headers: headersJson,
          body: JSON.stringify({
            shipment_ids: [shipmentId],
            response_type: 'pdf',
          }),
        });
        if (res.ok) {
          console.log(`Label generation requested via POST /shipment_labels/generate`);
          return;
        }
      },
    ];

    for (const fn of attempts) {
      try {
        await fn();
        await new Promise((r) => setTimeout(r, 1500));
      } catch {}
    }

    try {
      const s = await this.request<{ status: string }>(`/shipments/${shipmentId}`);
      console.log(`Shipment ${shipmentId} status after generation request: ${s.status}`);
    } catch (err) {
      console.log(
        `Could not refresh shipment ${shipmentId}: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }
}

export function filterByDateAndStatus(
  orders: MercadoLivreOrder[],
  daysAgo: number,
  statuses: string[]
): MercadoLivreOrder[] {
  const since = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  return orders.filter((order) => {
    const closed = order.date_closed ?? order.date_created;
    const orderTime = new Date(closed).getTime();
    if (orderTime < since) return false;
    if (!statuses.includes(order.status)) return false;
    return true;
  });
}

export function toInvoiceData(order: MercadoLivreOrder): import('./types').InvoiceData {
  return {
    orderId: String(order.id),
    date: order.date_closed ?? order.date_created,
    currency: order.currency_id,
    totalAmount: order.total_amount,
    buyerName: [order.buyer?.first_name, order.buyer?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim(),
    buyerNickname: order.buyer?.nickname ?? '',
    items: order.order_items.map((item) => ({
      title: item.item.title,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      subtotal: item.unit_price * item.quantity,
    })),
  };
}
