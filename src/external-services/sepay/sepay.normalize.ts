import { createHash } from 'crypto';
import { parseVnDateTime } from '../../common/vn-time';
import {
  BankTxType,
  NormalizedBankTx,
  SepayApiTransaction,
  SepayWebhookPayload,
} from './sepay.types';

const toInt = (value: unknown): number => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : 0;
};

const toText = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

/**
 * Dấu vân tay của một giao dịch ngân hàng: cùng tài khoản + mã tham chiếu + thời
 * điểm (giây) + chiều + số tiền thì là cùng một giao dịch, dù đến từ webhook hay API.
 */
export const buildFingerprint = (parts: {
  accountNumber: string;
  referenceCode: string;
  occurredAt: Date;
  type: BankTxType;
  amountVnd: number;
}): string =>
  createHash('sha256')
    .update(
      [
        parts.accountNumber,
        parts.referenceCode,
        Math.floor(parts.occurredAt.getTime() / 1000),
        parts.type,
        parts.amountVnd,
      ].join('|')
    )
    .digest('hex')
    .slice(0, 40);

/** Trả null nếu payload thiếu/ sai các trường bắt buộc. */
export const normalizeWebhookPayload = (
  payload: Partial<SepayWebhookPayload> | null | undefined
): NormalizedBankTx | null => {
  if (!payload) return null;

  const type = payload.transferType;
  if (type !== 'in' && type !== 'out') return null;

  const amountVnd = toInt(payload.transferAmount);
  const occurredAt = parseVnDateTime(payload.transactionDate);
  const accountNumber = toText(payload.accountNumber);
  if (amountVnd <= 0 || !occurredAt || !accountNumber) return null;
  if (payload.id === null || payload.id === undefined) return null;

  const referenceCode = toText(payload.referenceCode);

  return {
    fingerprint: buildFingerprint({
      accountNumber,
      referenceCode,
      occurredAt,
      type,
      amountVnd,
    }),
    source: 'webhook',
    sepayId: String(payload.id),
    accountNumber,
    bankName: toText(payload.gateway),
    type,
    amountVnd,
    occurredAt,
    content: toText(payload.content),
    description: toText(payload.description),
    referenceCode,
    code:
      payload.code === null || payload.code === undefined
        ? null
        : toText(payload.code),
    subAccount: toText(payload.subAccount),
    accumulatedVnd:
      payload.accumulated === null || payload.accumulated === undefined
        ? null
        : toInt(payload.accumulated),
    raw: { ...payload },
  };
};

/** Trả null nếu giao dịch không có tiền vào/ra hoặc thiếu trường bắt buộc. */
export const normalizeApiTransaction = (
  tx: Partial<SepayApiTransaction> | null | undefined
): NormalizedBankTx | null => {
  if (!tx) return null;

  const amountIn = toInt(tx.amount_in);
  const amountOut = toInt(tx.amount_out);
  const type: BankTxType | null =
    amountIn > 0 ? 'in' : amountOut > 0 ? 'out' : null;
  const occurredAt = parseVnDateTime(tx.transaction_date);
  const accountNumber = toText(tx.account_number);
  if (!type || !occurredAt || !accountNumber || !tx.id) return null;

  const amountVnd = type === 'in' ? amountIn : amountOut;
  const referenceCode = toText(tx.reference_number);

  return {
    fingerprint: buildFingerprint({
      accountNumber,
      referenceCode,
      occurredAt,
      type,
      amountVnd,
    }),
    source: 'api',
    sepayId: String(tx.id),
    accountNumber,
    bankName: toText(tx.bank_brand_name),
    type,
    amountVnd,
    occurredAt,
    content: toText(tx.transaction_content),
    description: '',
    referenceCode,
    code: tx.code === null || tx.code === undefined ? null : toText(tx.code),
    subAccount: toText(tx.va),
    accumulatedVnd:
      tx.accumulated === null || tx.accumulated === undefined
        ? null
        : toInt(tx.accumulated),
    raw: { ...tx },
  };
};
