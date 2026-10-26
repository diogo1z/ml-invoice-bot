import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertAllRecipientsAccepted, sendFilesByEmail } from './email';

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mocks.sendMail })),
  },
}));

vi.mock('./config', () => ({
  config: {
    email: {
      host: 'smtp.test',
      port: 587,
      secure: false,
      user: 'user@test',
      pass: 'secret',
      from: 'from@test',
      to: ['to@test'],
      labelsTo: ['a@test', 'b@test'],
    },
  },
}));

describe('assertAllRecipientsAccepted', () => {
  it('accepts when every recipient is accepted', () => {
    expect(() =>
      assertAllRecipientsAccepted(
        { accepted: ['a@test', 'b@test'], rejected: [] },
        ['a@test', 'b@test']
      )
    ).not.toThrow();
  });

  it('throws when a recipient was rejected', () => {
    expect(() =>
      assertAllRecipientsAccepted({ accepted: ['a@test'], rejected: ['b@test'] }, [
        'a@test',
        'b@test',
      ])
    ).toThrow('Email was not accepted for: b@test');
  });

  it('throws when a recipient is missing from accepted', () => {
    expect(() =>
      assertAllRecipientsAccepted({ accepted: ['a@test'] }, ['a@test', 'b@test'])
    ).toThrow('b@test');
  });

  it('is lenient when the transport does not report recipients', () => {
    expect(() => assertAllRecipientsAccepted({}, ['a@test'])).not.toThrow();
  });

  it('normalizes case and whitespace', () => {
    expect(() =>
      assertAllRecipientsAccepted({ accepted: [' A@TEST '], rejected: [] }, ['a@test'])
    ).not.toThrow();
  });
});

describe('sendFilesByEmail', () => {
  beforeEach(() => {
    mocks.sendMail.mockReset();
  });

  it('sends attachments and validates every recipient', async () => {
    mocks.sendMail.mockResolvedValue({
      accepted: ['a@test', 'b@test'],
      rejected: [],
    });

    await sendFilesByEmail(
      ['/tmp/label.pdf'],
      'Assunto',
      'Corpo',
      ['a@test', 'b@test']
    );

    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'from@test',
        to: 'a@test, b@test',
        subject: 'Assunto',
        text: 'Corpo',
      })
    );
  });

  it('throws when a recipient is rejected, so the caller can avoid marking it sent', async () => {
    mocks.sendMail.mockResolvedValue({
      accepted: ['a@test'],
      rejected: ['b@test'],
    });

    await expect(
      sendFilesByEmail(['/tmp/label.pdf'], 'Assunto', 'Corpo', ['a@test', 'b@test'])
    ).rejects.toThrow('b@test');
  });

  it('throws when there are no attachments', async () => {
    await expect(
      sendFilesByEmail([], 'Assunto', 'Corpo', ['a@test'])
    ).rejects.toThrow('No attachments to send.');
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});
