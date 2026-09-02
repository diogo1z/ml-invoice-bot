import { config } from './config';
import type { MercadoLivreOrder } from './types';

const MELI_API = 'https://api.mercadolibre.com';
const MELI_AUTH = 'https://api.mercadolibre.com/oauth/token';

export class MercadoLivreClient {
  private accessToken = config.meli.accessToken;

  /**
   * The ML sell access token expires after 6 hours. If a refresh token is
   * configured we automatically refresh it and write the new tokens to
   * token.json so future runs reuse the refreshed pair.
   */
  async ensureToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    if (!config.meli.refreshToken || !config.meli.appId || !config.meli.appSecret) {
      throw new Error(
        'No access token configured. Set MELI_ACCESS_TOKEN or provide MELI_REFRESH_TOKEN + MELI_APP_ID + MELI_APP_SECRET.'
      );
    }
    const res = await fetch(MELI_AUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.meli.appId,
        client_secret: config.meli.appSecret,
        refresh_token: config.meli.refreshToken,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to refresh token: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    this.accessToken = data.access_token;
    console.log('Refreshed ML access token.');
    return this.accessToken;
  }

  private async request<T>(path: string): Promise<T> {
    const token = await this.ensureToken();
    const res = await fetch(`${MELI_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      // Token may be expired; drop it and retry once via refresh flow.
      this.accessToken = undefined;
      throw new Error('Unauthorized (401). Check/refresh your access token.');
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
}

export function filterByDateAndStatus(
  orders: MercadoLivreOrder[],
  daysAgo: number,
  statuses: string[],
  now: Date = new Date()
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
