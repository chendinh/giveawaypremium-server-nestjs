import { createHmac, timingSafeEqual } from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import { getSepayConfig } from '../../config/sepay.config';

/** SePay khuyến nghị từ chối request lệch quá 5 phút để chống replay. */
const MAX_CLOCK_SKEW_SECONDS = 300;

export type SepayAuthResult =
  | { ok: true; method: 'hmac' | 'apikey' }
  | { ok: false; reason: string };

const firstHeader = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

const fail = (reason: string): SepayAuthResult => ({ ok: false, reason });

/**
 * Xác thực request webhook từ SePay. Fail-closed: chưa cấu hình khoá thì từ chối
 * toàn bộ, không bao giờ nhận webhook không xác thực.
 *
 * - HMAC-SHA256 (khuyến nghị): header `X-SePay-Signature: sha256=<hex>` và
 *   `X-SePay-Timestamp: <giây>`; chữ ký tính trên `{timestamp}.{raw body}`.
 * - API Key: header `Authorization: Apikey <key>`.
 *
 * Request phải xác thực đúng theo phương thức mà nó gửi kèm.
 */
export const verifySepayWebhook = (input: {
  headers: IncomingHttpHeaders;
  /** Body gốc (byte-exact). Bắt buộc với HMAC. */
  rawBody?: Buffer | string;
  nowMs?: number;
}): SepayAuthResult => {
  const cfg = getSepayConfig();
  if (!cfg.webhookSecret && !cfg.webhookApiKey) {
    return fail('Webhook SePay chưa được cấu hình khoá xác thực');
  }

  const signature = firstHeader(input.headers['x-sepay-signature']);
  const authorization = firstHeader(input.headers['authorization']);

  if (signature) {
    if (!cfg.webhookSecret) return fail('Chưa cấu hình SEPAY_WEBHOOK_SECRET');

    const timestamp = firstHeader(input.headers['x-sepay-timestamp']);
    const timestampSec = Number(timestamp);
    if (!timestamp || !Number.isFinite(timestampSec)) {
      return fail('Thiếu X-SePay-Timestamp');
    }
    const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
    if (Math.abs(nowSec - timestampSec) > MAX_CLOCK_SKEW_SECONDS) {
      return fail('Request đã hết hạn');
    }
    if (input.rawBody === undefined) {
      return fail('Không có raw body để kiểm tra chữ ký');
    }

    const expected =
      'sha256=' +
      createHmac('sha256', cfg.webhookSecret)
        .update(`${timestamp}.`)
        .update(input.rawBody)
        .digest('hex');
    return safeEqual(expected, signature)
      ? { ok: true, method: 'hmac' }
      : fail('Chữ ký không hợp lệ');
  }

  if (authorization) {
    if (!cfg.webhookApiKey) return fail('Chưa cấu hình SEPAY_WEBHOOK_API_KEY');
    const match = /^apikey\s+(.+)$/i.exec(authorization.trim());
    if (!match) return fail('Sai định dạng header Authorization');
    return safeEqual(match[1].trim(), cfg.webhookApiKey)
      ? { ok: true, method: 'apikey' }
      : fail('API key không hợp lệ');
  }

  return fail('Thiếu thông tin xác thực');
};
