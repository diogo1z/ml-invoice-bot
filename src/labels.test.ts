import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPendingShipments, generateLabelPdfs } from './labels';
import type { MercadoLivreClient } from './meli';
import type { MercadoLivreOrder } from './types';

const mocks = vi.hoisted(() => ({
  isLabelSent: vi.fn(),
  config: { outputDir: '' },
}));

vi.mock('./db', () => ({ isLabelSent: mocks.isLabelSent }));
vi.mock('./config', () => ({ config: mocks.config }));

function order(id: string, shipmentId?: number): MercadoLivreOrder {
  return {
    id,
    shipping: shipmentId ? { id: shipmentId } : undefined,
  } as MercadoLivreOrder;
}

beforeAll(() => {
  mocks.config.outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-labels-test-'));
});

afterAll(() => {
  fs.rmSync(mocks.config.outputDir, { recursive: true, force: true });
});

describe('collectPendingShipments', () => {
  beforeEach(() => {
    mocks.isLabelSent.mockReset();
  });

  it('classifies orders and keeps only ready-to-ship, unsent shipments', async () => {
    mocks.isLabelSent.mockImplementation(
      async (shipmentId: number) => shipmentId === 2
    );
    const meli = {
      fetchShipmentStatus: vi.fn(async (shipmentId: number) =>
        shipmentId === 3 ? 'shipped' : 'ready_to_ship'
      ),
    } as unknown as MercadoLivreClient;

    const result = await collectPendingShipments(
      [order('1', 1), order('2', 2), order('3', 3), order('4')],
      meli
    );

    expect(result.totalPaidOrders).toBe(4);
    expect(result.pending).toEqual([{ orderId: '1', shipmentId: 1 }]);
    expect(result.alreadySent).toBe(1);
    expect(result.notReady).toBe(1);
    expect(result.withoutShipping).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('stringifies numeric order ids defensively', async () => {
    mocks.isLabelSent.mockResolvedValue(false);
    const meli = {
      fetchShipmentStatus: vi.fn().mockResolvedValue('ready_to_ship'),
    } as unknown as MercadoLivreClient;

    const result = await collectPendingShipments(
      [order(123 as unknown as string, 10)],
      meli
    );

    expect(result.pending).toEqual([{ orderId: '123', shipmentId: 10 }]);
  });

  it('counts shipment status errors and continues', async () => {
    mocks.isLabelSent.mockResolvedValue(false);
    const meli = {
      fetchShipmentStatus: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as MercadoLivreClient;

    const result = await collectPendingShipments([order('1', 10)], meli);

    expect(result.errors).toBe(1);
    expect(result.pending).toEqual([]);
  });
});

describe('generateLabelPdfs', () => {
  it('downloads one PDF per shipment and handles numeric order ids', async () => {
    const meli = {
      fetchShipmentLabels: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
    } as unknown as MercadoLivreClient;

    const labels = await generateLabelPdfs(
      [{ orderId: 123 as unknown as string, shipmentId: 456 }],
      meli
    );

    expect(labels).toHaveLength(1);
    expect(labels[0].filePath).toBe(
      path.join(mocks.config.outputDir, 'label-123-456.pdf')
    );
    expect(fs.existsSync(labels[0].filePath)).toBe(true);
    expect(fs.readFileSync(labels[0].filePath).toString()).toBe('%PDF-1.4');
  });

  it('skips labels that fail to download', async () => {
    const meli = {
      fetchShipmentLabels: vi.fn().mockRejectedValue(new Error('download failed')),
    } as unknown as MercadoLivreClient;

    const labels = await generateLabelPdfs(
      [{ orderId: '1', shipmentId: 2 }],
      meli
    );

    expect(labels).toEqual([]);
  });
});
