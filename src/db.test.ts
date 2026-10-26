import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({
  config: {
    dbUrl: ':memory:',
    dbAuthToken: undefined,
  },
}));

type DbModule = typeof import('./db');

let db: DbModule;

beforeEach(async () => {
  vi.resetModules();
  db = await import('./db.js');
});

describe('sent label database', () => {
  it('stores a sent label and finds it later', async () => {
    expect(await db.isLabelSent(123)).toBe(false);

    await db.markLabelsSent([
      {
        shipmentId: 123,
        orderId: '456',
        labelFile: 'label-123.pdf',
        emailTo: 'a@test.com, b@test.com',
      },
    ]);

    expect(await db.isLabelSent(123)).toBe(true);
  });

  it('ignores duplicate shipment ids', async () => {
    const label = {
      shipmentId: 1,
      orderId: '2',
      labelFile: 'label-1.pdf',
      emailTo: 'a@test.com',
    };

    await db.markLabelsSent([label]);
    await db.markLabelsSent([label]);

    expect(await db.isLabelSent(1)).toBe(true);
  });

  it('does nothing when the list is empty', async () => {
    await db.markLabelsSent([]);
    expect(await db.isLabelSent(1)).toBe(false);
  });
});
