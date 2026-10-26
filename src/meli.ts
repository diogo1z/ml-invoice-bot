import { config } from './config';
import type { MercadoLivreOrder } from './types';

const MELI_API = 'https://api.mercadolibre.com';
const MELI_AUTH = 'https://api.mercadolibre.com/oauth/token';

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
    return data.results;
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
      all.push(...data.results);
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
    orderId: order.id,
    date: order.date_closed ?? order.date_created,
    currency: order.currency_id,
    totalAmount: order.total_amount,
    buyerName: [order.buyer?.first_name, order.buyer?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim(),
    buyerNickname: order.buyer?.nickname ?? '',
    items: order.order_items.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      subtotal: item.unit_price * item.quantity,
    })),
  };
}
