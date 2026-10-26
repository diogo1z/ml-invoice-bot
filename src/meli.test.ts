import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MercadoLivreClient,
  filterByDateAndStatus,
  normalizeOrder,
  toInvoiceData,
} from './meli';
import type { MercadoLivreOrder } from './types';

vi.mock('./config', () => ({
  config: {
    meli: {
      accessToken: 'test-token',
      appId: undefined,
      appSecret: undefined,
      refreshToken: undefined,
    },
  },
}));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => '',
  } as unknown as Response;
}

function order(id: string, extra: Partial<MercadoLivreOrder> = {}): MercadoLivreOrder {
  return { id, ...extra } as MercadoLivreOrder;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeOrder', () => {
  it('converts numeric ids to strings', () => {
    expect(normalizeOrder(order(123 as unknown as string)).id).toBe('123');
  });
});

describe('fetchPaidOrders', () => {
  it('paginates and normalizes numeric ids', async () => {
    const pages: Record<number, MercadoLivreOrder[]> = {
      0: Array.from({ length: 50 }, (_, i) => order((i + 1) as unknown as string)),
      50: Array.from({ length: 50 }, (_, i) => order((i + 51) as unknown as string)),
      100: Array.from({ length: 20 }, (_, i) => order((i + 101) as unknown as string)),
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/users/me')) return jsonResponse({ id: 999 });

      const offset = Number(new URL(url).searchParams.get('offset'));
      return jsonResponse({ results: pages[offset] ?? [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MercadoLivreClient();
    const orders = await client.fetchPaidOrders(120);

    expect(orders).toHaveLength(120);
    expect(orders.every((item) => typeof item.id === 'string')).toBe(true);
    expect(orders[0].id).toBe('1');
    expect(orders[119].id).toBe('120');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('filterByDateAndStatus', () => {
  it('filters by status and date window', () => {
    const now = Date.now();
    const recentPaid = order('1', {
      status: 'paid',
      date_created: new Date(now - 60_000).toISOString(),
    });
    const oldPaid = order('2', {
      status: 'paid',
      date_created: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const recentCancelled = order('3', {
      status: 'cancelled',
      date_created: new Date(now - 60_000).toISOString(),
    });

    expect(filterByDateAndStatus([recentPaid, oldPaid, recentCancelled], 7, ['paid'])).toEqual([
      recentPaid,
    ]);
  });
});

describe('toInvoiceData', () => {
  it('maps order fields and stringifies the id', () => {
    const invoice = toInvoiceData(
      order(123 as unknown as string, {
        date_closed: '2026-01-02T00:00:00.000Z',
        currency_id: 'BRL',
        total_amount: 59.9,
        buyer: { id: 1, first_name: 'Ana', last_name: 'Silva', nickname: 'ANA' },
        order_items: [
          { id: 'item-1', title: 'Item', quantity: 2, unit_price: 29.95, sale_fee: 0 },
        ],
      })
    );

    expect(invoice).toEqual({
      orderId: '123',
      date: '2026-01-02T00:00:00.000Z',
      currency: 'BRL',
      totalAmount: 59.9,
      buyerName: 'Ana Silva',
      buyerNickname: 'ANA',
      items: [{ title: 'Item', quantity: 2, unitPrice: 29.95, subtotal: 59.9 }],
    });
  });
});
