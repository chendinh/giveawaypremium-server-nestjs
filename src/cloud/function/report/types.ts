/**
 * DTO của báo cáo kiểm kê tháng — hợp đồng giữa server và trang /admin/bao-cao.
 * Mọi số tiền là VND (đã quy đổi từ đơn vị nghìn đồng trong DB), hậu tố `Vnd`.
 * Thời điểm là chuỗi ISO 8601 (UTC).
 */
import { OrderChannel } from './derive';
import { MonthlyExpensesDto } from './expenses';
import { TargetStatus } from './matcher';

export interface ChannelTotals {
  orderCount: number;
  productCount: number;
  revenueVnd: number;
  consignerShareVnd: number;
  /** Phí ký gửi = revenueVnd − consignerShareVnd. Đây là lợi nhuận chính của shop. */
  feeVnd: number;
  bankVnd: number;
  cashVnd: number;
}

export interface ReportOrderRow {
  id: string;
  createdAt: string;
  channel: OrderChannel;
  pickup: 'self' | 'shipper' | null;
  customerName: string;
  phone: string;
  staffName: string | null;
  productCount: number;
  revenueVnd: number;
  consignerShareVnd: number;
  feeVnd: number;
  bankVnd: number;
  cashVnd: number;
  paymentGapVnd: number;
}

export interface ReportPayoutRow {
  id: string;
  consignmentId: string;
  consignerName: string;
  method: 'bank' | 'cash';
  bankName: string;
  accountMasked: string;
  moneyBackVnd: number;
  paidAt: string;
  markedBy: string | null;
}

export interface PayoutSummary {
  bankCount: number;
  bankVnd: number;
  cashCount: number;
  cashVnd: number;
  totalVnd: number;
}

// ─── Đối chiếu ngân hàng ──────────────────────────────────────────────────────

export type ReconTxStatus = 'matched' | 'mismatch' | 'unmatched' | 'explained';
export type MatchSource = 'auto' | 'manual';

export interface ReconTxTarget {
  type: 'order' | 'consignment';
  id: string;
  label: string;
  amountVnd: number;
}

export interface ReconTxDto {
  id: string;
  type: 'in' | 'out';
  at: string;
  /** Giao dịch nằm trong tháng báo cáo (khác với phần đệm hai đầu dùng để ghép) */
  inMonth: boolean;
  amountVnd: number;
  bankName: string;
  accountMasked: string;
  content: string;
  referenceCode: string;
  status: ReconTxStatus;
  source: MatchSource | null;
  targets: ReconTxTarget[];
  explanation: string | null;
  linkedByName: string | null;
  linkedAt: string | null;
}

interface ReconItemBase {
  id: string;
  expectedVnd: number;
  allocatedVnd: number;
  /** allocated − expected: âm = thiếu, dương = thừa */
  diffVnd: number;
  status: TargetStatus;
  source: MatchSource | null;
  txIds: string[];
}

export interface ReconOrderItemDto extends ReconItemBase {
  at: string;
  channel: OrderChannel;
  customerName: string;
  phone: string;
  staffName: string | null;
  /** Nhân viên đã bấm "đã nhận tiền" (đơn online) */
  moneyConfirmed: boolean | null;
}

export interface ReconPayoutItemDto extends ReconItemBase {
  consignmentId: string;
  consignerName: string;
  bankName: string;
  accountMasked: string;
  paidAt: string;
  markedBy: string | null;
}

export interface ReconSideSummary {
  /** Tổng cần có theo dữ liệu hệ thống */
  expectedVnd: number;
  /** Tổng tiền ngân hàng đã khớp vào các khoản trên */
  allocatedVnd: number;
  /** Tổng giao dịch ngân hàng cùng chiều trong tháng */
  bankTotalVnd: number;
  bankCount: number;
  matchedCount: number;
  mismatchCount: number;
  missingCount: number;
  /** Tổng tiền các khoản chưa thấy giao dịch nào */
  missingVnd: number;
  /** Tổng tiền thiếu so với mong đợi (khoản lệch tiền) */
  shortVnd: number;
  /** Tổng tiền thừa so với mong đợi (khoản lệch tiền) */
  excessVnd: number;
  unmatchedTxCount: number;
  unmatchedTxVnd: number;
  explainedTxCount: number;
}

export interface ReconciliationDto {
  configured: { webhook: boolean; api: boolean };
  /** Có giao dịch ngân hàng nào trong khoảng thời gian của báo cáo không */
  hasData: boolean;
  lastTransactionAt: string | null;
  error?: string;
  inbound: {
    summary: ReconSideSummary;
    items: ReconOrderItemDto[];
    transactions: ReconTxDto[];
  } | null;
  outbound: {
    summary: ReconSideSummary;
    items: ReconPayoutItemDto[];
    transactions: ReconTxDto[];
  } | null;
}

// ─── Chi phí & lợi nhuận ──────────────────────────────────────────────────────

export interface ProfitSummary {
  /** Tổng phí ký gửi (lợi nhuận gộp) của các đơn trong tháng */
  feeVnd: number;
  /** Tổng chi phí vận hành đã nhập cho tháng (lương, điện nước, khác...) */
  expensesVnd: number;
  /** feeVnd − expensesVnd */
  netVnd: number;
}

/**
 * Tách consignerShareVnd (tiền phải trả khách ký gửi, tạm tính theo doanh số
 * bán TRONG THÁNG) thành đã trả / chưa trả — paidVnd + unpaidVnd = totalVnd
 * luôn đúng (không phải 2 số lấy từ nguồn khác nhau). Xem payout-breakdown.ts.
 */
export interface ConsignerShareBreakdownDto {
  totalVnd: number;
  /** Trong totalVnd, phần ký gửi tương ứng đã được đánh dấu "đã trả" (tính đến hiện tại) */
  paidVnd: number;
  /** Trong paidVnd, phần được xác nhận trả CŨNG rơi vào đúng tháng báo cáo */
  paidThisMonthVnd: number;
  /** Phần còn lại — khách thực tế CHƯA NHẬN, chỉ riêng cho hàng bán tháng này */
  unpaidVnd: number;
  /** Số đơn không lần ra được trạng thái trả (thiếu dữ liệu), đã tính là chưa trả */
  unresolvedOrderCount: number;
}

/**
 * Nguồn gốc của tiền ĐÃ CHUYỂN thực tế trong tháng (payouts.summary.totalVnd)
 * — tách theo tháng BÁN của hàng được trả tiền, KHÔNG phải tách consignerShareVnd
 * (xem ConsignerShareBreakdownDto, 2 khái niệm khác nhau: cái này nhìn từ chiều
 * tiền thực đã rời quỹ, cái trên nhìn từ chiều nghĩa vụ phải trả theo hàng bán).
 */
export interface PayoutOriginBreakdownDto {
  totalVnd: number;
  /** Trả cho hàng bán TRONG tháng này */
  forThisMonthSalesVnd: number;
  /** Trả cho hàng bán ở THÁNG KHÁC — "không phải do bán được tháng này" */
  forOtherMonthSalesVnd: number;
  /** Số payout không lần ra được lịch sử bán, tạm tính là "tháng khác" */
  unresolvedPayoutCount: number;
}

// ─── Tiền shop đang giữ ────────────────────────────────────────────────────────

export type BalanceSource = 'api' | 'last_transaction' | 'unavailable';

export interface HoldingAccountDto {
  accountNumber: string;
  bankName: string;
  balanceVnd: number;
}

export interface HoldingDto {
  /** Tổng số dư các tài khoản ngân hàng đã liên kết; null nếu không lấy được */
  bankBalanceVnd: number | null;
  balanceSource: BalanceSource;
  /** Thời điểm số dư được lấy (api) hoặc thời điểm giao dịch gần nhất (fallback) */
  asOf: string | null;
  accounts: HoldingAccountDto[];
  /**
   * Tiền còn phải trả khách ký gửi — chỉ tính ký gửi tạo từ UNPAID_TRACKING_START
   * (xem holding.ts), dữ liệu trước mốc này không được tính nữa (quyết định
   * nghiệp vụ, không rà soát lại lịch sử cũ).
   */
  unpaidToConsignersVnd: number;
  unpaidConsignmentCount: number;
  /** bankBalanceVnd − unpaidToConsignersVnd; null nếu không có bankBalanceVnd */
  surplusVnd: number | null;
  warning?: string;
}

export interface ReportCacheInfo {
  /** 'snapshot' = đọc từ bản lưu sẵn (tháng đã qua); 'live' = vừa tính trực tiếp */
  source: 'snapshot' | 'live';
  /** Thời điểm bản lưu được ghi; null nếu báo cáo không được lưu (tháng hiện tại) */
  savedAt: string | null;
}

export interface MonthlyReport {
  month: string;
  /** Đầu tháng (giờ VN) */
  from: string;
  /** Đầu tháng sau (loại trừ) */
  to: string;
  generatedAt: string;
  generatedBy: string;
  totals: {
    online: ChannelTotals;
    offline: ChannelTotals;
    all: ChannelTotals;
  };
  orders: ReportOrderRow[];
  payouts: { rows: ReportPayoutRow[]; summary: PayoutSummary };
  expenses: MonthlyExpensesDto;
  profit: ProfitSummary;
  consignerShareBreakdown: ConsignerShareBreakdownDto;
  payoutOrigin: PayoutOriginBreakdownDto;
  /** Tiền shop đang giữ tính đến lúc xem báo cáo (không giới hạn theo tháng) */
  holding: HoldingDto;
  quality: { paymentGapOrders: number };
  reconciliation: ReconciliationDto;
  /** Gắn lúc trả về, không nằm trong bản lưu */
  cache?: ReportCacheInfo;
}
