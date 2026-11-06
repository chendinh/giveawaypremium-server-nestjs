export type BankTxType = 'in' | 'out';

/**
 * Payload SePay gửi tới webhook.
 * Nguồn: developer.sepay.vn → SePay Webhooks → Tích hợp webhook.
 */
export interface SepayWebhookPayload {
  /** ID giao dịch trên SePay (số nguyên) — khác với `id` (UUID) của API v2 */
  id: number;
  gateway: string;
  /** 'YYYY-MM-DD HH:mm:ss', giờ Việt Nam */
  transactionDate: string;
  accountNumber: string;
  subAccount?: string | null;
  code?: string | null;
  content?: string | null;
  transferType: BankTxType;
  description?: string | null;
  /** Luôn dương, đơn vị VND */
  transferAmount: number;
  accumulated?: number | null;
  referenceCode?: string | null;
}

/** Một giao dịch trong SePay API v2: `GET /v2/transactions`. */
export interface SepayApiTransaction {
  /** UUID */
  id: string;
  /** 'YYYY-MM-DD HH:mm:ss', giờ Việt Nam */
  transaction_date: string;
  account_number: string;
  amount_in: number | string;
  amount_out: number | string;
  accumulated?: number | string | null;
  transaction_content?: string | null;
  reference_number?: string | null;
  code?: string | null;
  bank_brand_name?: string | null;
  va?: string | null;
  transfer_type?: BankTxType;
}

export interface SepayApiListResponse {
  status: string;
  data?: SepayApiTransaction[];
  meta?: {
    pagination?: {
      has_more?: boolean;
      current_page?: number;
      last_page?: number;
    };
  };
}

/** Giao dịch đã chuẩn hoá, không phụ thuộc nguồn (webhook hay API). */
export interface NormalizedBankTx {
  /**
   * Khoá chống trùng. ID của webhook (số) và của API v2 (UUID) khác nhau cho cùng
   * một giao dịch, nên không dùng ID mà dùng dấu vân tay từ chính nội dung giao dịch.
   */
  fingerprint: string;
  source: 'webhook' | 'api';
  sepayId: string;
  accountNumber: string;
  bankName: string;
  type: BankTxType;
  /** VND, luôn dương */
  amountVnd: number;
  occurredAt: Date;
  content: string;
  description: string;
  referenceCode: string;
  code: string | null;
  subAccount: string;
  accumulatedVnd: number | null;
  raw: Record<string, unknown>;
}
