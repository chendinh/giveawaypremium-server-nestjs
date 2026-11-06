import { formatVnDateTime } from '../../common/vn-time';
import { getSepayConfig } from '../../config/sepay.config';
import { normalizeApiTransaction } from './sepay.normalize';
import { NormalizedBankTx, SepayApiListResponse } from './sepay.types';

export interface SepayBankAccountDto {
  accountNumber: string;
  bankName: string;
  /** Số dư hiện tại (VND) */
  balanceVnd: number;
}

interface SepayBankAccountsResponse {
  status: string;
  data?: Array<{
    account_number: string;
    accumulated: number | string;
    bank_brand_name?: string;
    label?: string;
    active?: number | string;
  }>;
  meta?: { pagination?: { has_more?: boolean } };
}

const REQUEST_TIMEOUT_MS = 20_000;
/** SePay API v2 giới hạn 3 request/giây/IP → chờ giữa các trang. */
const PAGE_DELAY_MS = 400;
const MAX_RETRIES_ON_429 = 3;
const PER_PAGE = 100;
/** Chặn vòng lặp vô hạn nếu API trả has_more sai: tối đa 100 × 100 giao dịch. */
const MAX_PAGES = 100;

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

const requestJson = async <T>(url: string, token: string): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (res.status === 429 && attempt < MAX_RETRIES_ON_429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 1;
        await sleep(Math.min(retryAfter, 5) * 1000);
        continue;
      }
      if (res.status === 401) {
        throw new Error(
          'SePay từ chối API token (SEPAY_API_TOKEN sai hoặc đã bị vô hiệu)'
        );
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`SePay API lỗi ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new Error('SePay API không phản hồi (quá thời gian chờ)');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
};

/**
 * Lấy toàn bộ giao dịch trong [from, to] (cả hai đầu đều bao gồm) từ SePay API v2,
 * sắp xếp cũ → mới. Dùng để bù dữ liệu cho kỳ webhook chưa được cấu hình hoặc bị lỡ.
 */
export const fetchSepayTransactions = async (range: {
  from: Date;
  to: Date;
}): Promise<NormalizedBankTx[]> => {
  const cfg = getSepayConfig();
  if (!cfg.apiToken) {
    throw new Error('Chưa cấu hình SEPAY_API_TOKEN trên server');
  }

  const results: NormalizedBankTx[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(`${cfg.apiUrl}/transactions`);
    url.searchParams.set('transaction_date_from', formatVnDateTime(range.from));
    url.searchParams.set('transaction_date_to', formatVnDateTime(range.to));
    url.searchParams.set('transaction_date_sort', 'asc');
    url.searchParams.set('per_page', String(PER_PAGE));
    url.searchParams.set('page', String(page));

    const body = await requestJson<SepayApiListResponse>(
      url.toString(),
      cfg.apiToken
    );
    for (const item of body.data ?? []) {
      const normalized = normalizeApiTransaction(item);
      if (normalized) results.push(normalized);
    }

    if (!body.meta?.pagination?.has_more) break;
    await sleep(PAGE_DELAY_MS);
  }

  return results;
};

/**
 * Lấy số dư hiện tại của các tài khoản ngân hàng đã liên kết trong SePay — dùng để
 * biết "shop đang giữ bao nhiêu tiền" trước khi trừ phần còn phải trả khách ký gửi.
 */
export const fetchSepayBankAccounts = async (): Promise<
  SepayBankAccountDto[]
> => {
  const cfg = getSepayConfig();
  if (!cfg.apiToken) {
    throw new Error('Chưa cấu hình SEPAY_API_TOKEN trên server');
  }

  const results: SepayBankAccountDto[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(`${cfg.apiUrl}/bank-accounts`);
    url.searchParams.set('active', '1');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));

    const body = await requestJson<SepayBankAccountsResponse>(
      url.toString(),
      cfg.apiToken
    );
    for (const acc of body.data ?? []) {
      results.push({
        accountNumber: String(acc.account_number || ''),
        bankName: String(acc.bank_brand_name || acc.label || ''),
        balanceVnd: Math.round(Number(acc.accumulated)) || 0,
      });
    }

    if (!body.meta?.pagination?.has_more) break;
    await sleep(PAGE_DELAY_MS);
  }

  return results;
};
