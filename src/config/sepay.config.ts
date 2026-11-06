export interface SepayConfig {
  /** Base URL của SePay API v2 (không có dấu / cuối) */
  apiUrl: string;
  /** API token (my.sepay.vn → Cấu hình công ty → API Access). Chỉ dùng phía server. */
  apiToken: string;
  /** Khoá cho kiểu xác thực "API Key" của webhook (header `Authorization: Apikey <key>`) */
  webhookApiKey: string;
  /** Secret cho kiểu xác thực "HMAC-SHA256" của webhook (khuyến nghị) */
  webhookSecret: string;
  /** Chỉ nhận giao dịch của các số tài khoản này. Rỗng = nhận tất cả tài khoản trong SePay. */
  accountNumbers: string[];
}

/**
 * Đọc env tại thời điểm gọi (không đọc lúc import): thứ tự import module của Nest
 * có thể chạy trước khi ConfigModule nạp file .env.
 */
export const getSepayConfig = (): SepayConfig => ({
  apiUrl: (process.env.SEPAY_API_URL || 'https://userapi.sepay.vn/v2').replace(
    /\/+$/,
    ''
  ),
  apiToken: process.env.SEPAY_API_TOKEN || '',
  webhookApiKey: process.env.SEPAY_WEBHOOK_API_KEY || '',
  webhookSecret: process.env.SEPAY_WEBHOOK_SECRET || '',
  accountNumbers: (process.env.SEPAY_ACCOUNT_NUMBERS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean),
});
