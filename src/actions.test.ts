import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendLabelsByEmail } from './actions';
import type { MercadoLivreOrder } from './types';

const mocks = vi.hoisted(() => ({
  fetchPaidOrders: vi.fn(),
  collectPendingShipments: vi.fn(),
  generateLabelPdfs: vi.fn(),
  sendFilesByEmail: vi.fn(),
  markLabelsSent: vi.fn(),
  config: {
    labelsMaxOrders: 300,
    email: { labelsTo: ['a@test.com', 'b@test.com'] },
  },
}));

vi.mock('./meli', () => ({
  MercadoLivreClient: class {
    fetchPaidOrders = mocks.fetchPaidOrders;
  },
  filterByDateAndStatus: vi.fn(),
  toInvoiceData: vi.fn(),
}));

vi.mock('./labels', () => ({
  collectPendingShipments: mocks.collectPendingShipments,
  generateLabelPdfs: mocks.generateLabelPdfs,
}));

vi.mock('./email', () => ({
  sendFilesByEmail: mocks.sendFilesByEmail,
  sendInvoiceByEmail: vi.fn(),
  sendTestEmail: vi.fn(),
}));

vi.mock('./invoice', () => ({
  generateInvoice: vi.fn(),
}));

vi.mock('./db', () => ({
  markLabelsSent: mocks.markLabelsSent,
  isLabelSent: vi.fn(),
}));

vi.mock('./config', () => ({
  config: mocks.config,
}));

const emptyResult = {
  totalPaidOrders: 0,
  pending: [],
  alreadySent: 0,
  notReady: 0,
  withoutShipping: 0,
  errors: 0,
};

const pendingShipment = { orderId: '1', shipmentId: 10 };
const generatedLabel = { ...pendingShipment, filePath: 'invoices/label-1-10.pdf' };
const orderFixture: MercadoLivreOrder = {
  id: '1',
  status: 'paid',
  date_created: '2026-01-01T00:00:00.000Z',
  total_amount: 59.9,
  currency_id: 'BRL',
  buyer: { id: 1, nickname: 'BUYER' },
  order_items: [
    {
      item: { id: 'item-1', title: 'Camiseta' },
      quantity: 2,
      unit_price: 29.95,
      sale_fee: 0,
    },
  ],
  shipping: { id: 10 },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.email.labelsTo = ['a@test.com', 'b@test.com'];
  mocks.fetchPaidOrders.mockResolvedValue([]);
  mocks.collectPendingShipments.mockResolvedValue(emptyResult);
  mocks.generateLabelPdfs.mockResolvedValue([]);
  mocks.sendFilesByEmail.mockResolvedValue(undefined);
  mocks.markLabelsSent.mockResolvedValue(undefined);
});

describe('sendLabelsByEmail', () => {
  it('does nothing when there are no pending labels', async () => {
    await sendLabelsByEmail();

    expect(mocks.sendFilesByEmail).not.toHaveBeenCalled();
    expect(mocks.markLabelsSent).not.toHaveBeenCalled();
  });

  it('fails before downloading when LABELS_EMAIL_TO is not configured', async () => {
    mocks.config.email.labelsTo = [];
    mocks.collectPendingShipments.mockResolvedValue({
      ...emptyResult,
      totalPaidOrders: 1,
      pending: [pendingShipment],
    });

    await expect(sendLabelsByEmail()).rejects.toThrow(
      'LABELS_EMAIL_TO is not configured.'
    );
    expect(mocks.generateLabelPdfs).not.toHaveBeenCalled();
    expect(mocks.sendFilesByEmail).not.toHaveBeenCalled();
    expect(mocks.markLabelsSent).not.toHaveBeenCalled();
  });

  it('sends the email before saving the labels as sent', async () => {
    mocks.fetchPaidOrders.mockResolvedValue([orderFixture]);
    mocks.collectPendingShipments.mockResolvedValue({
      ...emptyResult,
      totalPaidOrders: 1,
      pending: [pendingShipment],
    });
    mocks.generateLabelPdfs.mockResolvedValue([generatedLabel]);

    await sendLabelsByEmail();

    expect(mocks.sendFilesByEmail).toHaveBeenCalledWith(
      ['invoices/label-1-10.pdf'],
      'Etiquetas de envio - 1 pedido(s) para enviar',
      expect.stringContaining('Pedidos a serem enviados: 1'),
      ['a@test.com', 'b@test.com']
    );
    const body = mocks.sendFilesByEmail.mock.calls[0][2] as string;
    expect(body).toContain('1. Pedido 1');
    expect(body).toContain('   Itens:');
    expect(body).toContain('   - 2x Camiseta');
    expect(body).toContain('   Etiqueta: label-1-10.pdf (envio 10)');
    expect(mocks.markLabelsSent).toHaveBeenCalledWith([
      {
        shipmentId: 10,
        orderId: '1',
        labelFile: 'invoices/label-1-10.pdf',
        emailTo: 'a@test.com, b@test.com',
      },
    ]);
    expect(mocks.sendFilesByEmail.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markLabelsSent.mock.invocationCallOrder[0]
    );
  });

  it('does not save labels when the email fails', async () => {
    mocks.collectPendingShipments.mockResolvedValue({
      ...emptyResult,
      pending: [pendingShipment],
    });
    mocks.generateLabelPdfs.mockResolvedValue([generatedLabel]);
    mocks.sendFilesByEmail.mockRejectedValue(new Error('SMTP down'));

    await expect(sendLabelsByEmail()).rejects.toThrow('SMTP down');
    expect(mocks.markLabelsSent).not.toHaveBeenCalled();
  });

  it('does not send or save when no label could be generated', async () => {
    mocks.collectPendingShipments.mockResolvedValue({
      ...emptyResult,
      pending: [pendingShipment],
    });
    mocks.generateLabelPdfs.mockResolvedValue([]);

    await expect(sendLabelsByEmail()).rejects.toThrow(
      'Could not generate any labels (1 failed)'
    );
    expect(mocks.sendFilesByEmail).not.toHaveBeenCalled();
    expect(mocks.markLabelsSent).not.toHaveBeenCalled();
  });

  it('sends and saves successful labels, then reports partial failures', async () => {
    mocks.collectPendingShipments.mockResolvedValue({
      ...emptyResult,
      pending: [pendingShipment, { orderId: '2', shipmentId: 20 }],
    });
    mocks.generateLabelPdfs.mockResolvedValue([generatedLabel]);

    await expect(sendLabelsByEmail()).rejects.toThrow(
      '1 label(s) could not be generated'
    );
    expect(mocks.sendFilesByEmail).toHaveBeenCalledTimes(1);
    expect(mocks.markLabelsSent).toHaveBeenCalledWith([
      {
        shipmentId: 10,
        orderId: '1',
        labelFile: 'invoices/label-1-10.pdf',
        emailTo: 'a@test.com, b@test.com',
      },
    ]);
  });
});
