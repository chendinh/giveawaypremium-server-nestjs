import { parseDayMonthYear } from '../../../common/vn-time';
import { convertPriceAfterFee } from '../order-summary';

/**
 * Quy đổi dữ liệu thô của Order / Consignment sang số liệu báo cáo.
 *
 * Quy ước tiền: DB lưu theo NGHÌN ĐỒNG (100 = 100.000đ). Mọi giá trị trả ra từ
 * module này đã nhân ×1000 và làm tròn về đồng nguyên, hậu tố `Vnd`.
 */

export const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const thousandsToVnd = (thousands: number): number =>
  Math.round(thousands * 1000);

/** Số tiền lệch nhỏ hơn mức này (do làm tròn giá) không coi là sai lệch. */
const ROUNDING_TOLERANCE_VND = 1000;

// ─── Order ────────────────────────────────────────────────────────────────────

/** Các field cần đọc từ Order (không lấy productList để nhẹ payload). */
export const ORDER_SELECT_FIELDS = [
  'totalMoneyForSale',
  'totalMoneyForSaleAfterFee',
  'totalNumberOfProductForSale',
  'isOnlineSale',
  'transporter',
  'shippingInfo',
  'isTransferMoneyWithBank',
  'transferBankMoneyAmount',
  'transferOfflineMoneyAmount',
  'fullName',
  'phoneNumber',
  'consignee',
  'isGetMoney',
  'timeConfirmGetMoney',
  // Chỉ dùng nội bộ để tách "đã trả / chưa trả" theo từng sản phẩm
  // (payout-breakdown.ts) — KHÔNG trả ra client trong `orders:` của report.
  'productList',
];

export type OrderChannel = 'online' | 'offline';

export interface DerivedOrder {
  id: string;
  createdAt: Date;
  channel: OrderChannel;
  /** Chỉ có nghĩa với đơn online */
  pickup: 'self' | 'shipper' | null;
  customerName: string;
  phone: string;
  staffId: string | null;
  productCount: number;
  revenueVnd: number;
  /** Phần phải trả khách ký gửi */
  consignerShareVnd: number;
  /**
   * Phí ký gửi (hoa hồng) — phần shop giữ lại từ đơn này, đây là LỢI NHUẬN chính
   * của shop (shop không sở hữu hàng, chỉ ăn phí trên phần đã bán thực tế).
   */
  feeVnd: number;
  bankVnd: number;
  cashVnd: number;
  /** (bank + cash) − doanh thu; 0 nếu chênh lệch chỉ do làm tròn */
  paymentGapVnd: number;
  /** Đơn online: nhân viên đã bấm "đã nhận tiền" chưa. Đơn offline: null */
  moneyConfirmed: boolean | null;
  moneyConfirmedAt: string | null;
  /**
   * Snapshot sản phẩm của đơn — chỉ dùng nội bộ để tính payout-breakdown
   * (đã trả/chưa trả theo từng ký gửi). KHÔNG đưa field này ra DTO trả client.
   */
  productList: Array<{
    count?: number;
    priceAfterFee?: number;
    consignment?: { objectId?: string } | null;
  }>;
}

export const deriveOrder = (order: Parse.Object): DerivedOrder => {
  const totalK = toNumber(order.get('totalMoneyForSale'));
  const afterFeeK = toNumber(order.get('totalMoneyForSaleAfterFee'));
  // Đơn cũ không có totalMoneyForSaleAfterFee → dùng cùng công thức với getOrderSummary.
  // Phần trả khách ký gửi KHÔNG BAO GIỜ được lớn hơn tổng tiền bán (shop luôn ăn
  // hoa hồng trên phần đã bán, xem convertPriceAfterFee — tối đa ăn 80%, tối
  // thiểu 74%). Từng phát hiện dữ liệu một số đơn tháng 8/2026 bị cộng dồn qua
  // nhiều đơn (field totalMoneyForSaleAfterFee lưu sai), khiến phần trả khách
  // lớn hơn cả doanh thu — coi là dữ liệu hỏng, bỏ qua và dùng công thức chuẩn.
  const shareK =
    afterFeeK > 0 && afterFeeK <= totalK + ROUNDING_TOLERANCE_VND / 1000
      ? afterFeeK
      : convertPriceAfterFee(totalK);

  // Giống getOrderSummary: có vận đơn → online dù isOnlineSale bị thiếu (đơn cũ).
  // Đơn "khách tự đến lấy" không có vận đơn nhưng vẫn là online nhờ isOnlineSale.
  const transporter = order.get('transporter');
  const isOnline =
    !!(transporter && transporter.id) || order.get('isOnlineSale') === true;
  const shipping = (order.get('shippingInfo') || {}) as {
    pickupType?: unknown;
  };

  // SaleScreen chỉ lưu transferBankMoneyAmount / transferOfflineMoneyAmount khi
  // chia tiền ngân hàng + tiền mặt. Đơn trả hoàn toàn bằng CK hoặc hoàn toàn bằng
  // tiền mặt lưu cả hai = 0, nên phải suy ra từ cờ isTransferMoneyWithBank.
  const bankInputK = toNumber(order.get('transferBankMoneyAmount'));
  const cashInputK = toNumber(order.get('transferOfflineMoneyAmount'));
  let bankK = 0;
  let cashK = 0;
  if (bankInputK > 0 || cashInputK > 0) {
    bankK = bankInputK;
    cashK = cashInputK;
  } else if (order.get('isTransferMoneyWithBank') === true) {
    bankK = totalK;
  } else {
    cashK = totalK;
  }

  const revenueVnd = thousandsToVnd(totalK);
  const consignerShareVnd = thousandsToVnd(shareK);
  const bankVnd = thousandsToVnd(bankK);
  const cashVnd = thousandsToVnd(cashK);
  const rawGap = bankVnd + cashVnd - revenueVnd;

  const consignee = order.get('consignee');
  const confirmedAt = order.get('timeConfirmGetMoney');

  return {
    id: order.id,
    createdAt: order.createdAt,
    channel: isOnline ? 'online' : 'offline',
    pickup: isOnline
      ? shipping.pickupType === 'self'
        ? 'self'
        : 'shipper'
      : null,
    customerName: String(order.get('fullName') || '').trim(),
    phone: String(order.get('phoneNumber') || '').trim(),
    staffId: consignee?.id ?? null,
    productCount: toNumber(order.get('totalNumberOfProductForSale')),
    revenueVnd,
    consignerShareVnd,
    feeVnd: revenueVnd - consignerShareVnd,
    bankVnd,
    cashVnd,
    paymentGapVnd: Math.abs(rawGap) > ROUNDING_TOLERANCE_VND ? rawGap : 0,
    moneyConfirmed: isOnline ? order.get('isGetMoney') === true : null,
    moneyConfirmedAt:
      isOnline && order.get('isGetMoney') === true && confirmedAt
        ? String(confirmedAt)
        : null,
    productList: Array.isArray(order.get('productList'))
      ? order.get('productList')
      : [],
  };
};

// ─── Consignment payout ───────────────────────────────────────────────────────

export const PAYOUT_SELECT_FIELDS = [
  'consignmentId',
  'consignerName',
  'phoneNumber',
  'banks',
  'bankName',
  'bankId',
  'moneyBack',
  'totalMoney',
  'isGetMoney',
  'timeConfirmGetMoney',
  'isTransferMoneyWithBank',
  'note',
];

export interface DerivedPayout {
  id: string;
  consignmentId: string;
  consignerName: string;
  phone: string;
  /** Hình thức trả khách: chuyển khoản (đối chiếu được với ngân hàng) hay trực tiếp */
  method: 'bank' | 'cash';
  bankName: string;
  /** Số tài khoản đầy đủ — chỉ dùng nội bộ server, không trả ra client */
  bankAccount: string;
  moneyBackVnd: number;
  /** Thời điểm nhân viên bấm xác nhận "đã trả tiền" */
  paidAt: Date;
  paidAtText: string;
  /** Nhân viên bấm xác nhận, đọc từ dòng audit trong note của ký gửi */
  markedBy: string | null;
}

const PAID_NOTE_PATTERN =
  /^\[\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\]\s*(.+?)\s+xác nhận ĐÃ TRẢ TIỀN/i;

/** Tên nhân viên ở dòng audit "xác nhận ĐÃ TRẢ TIỀN" gần nhất trong note. */
export const extractPaidMarker = (note: unknown): string | null => {
  const lines = String(note || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = PAID_NOTE_PATTERN.exec(lines[i].trim());
    if (match) return match[1].trim();
  }
  return null;
};

/**
 * moneyBack không bao giờ được lớn hơn totalMoney (tiền trả khách chỉ là một
 * phần của tổng giá trị lô ký gửi, không thể vượt quá). Một số ký gửi cũ bị
 * nhập moneyBack theo đơn vị VND nguyên thay vì nghìn đồng (lệch đúng 1000
 * lần — xem steering sepay-flow, lỗi lịch sử tương tự ×1000). Phát hiện +
 * sửa tại đây để mọi nơi đọc moneyBack qua derivePayout đều ra số đúng,
 * không cần sửa từng chỗ gọi.
 */
export const safeMoneyBack = (moneyBack: number, totalMoney: number): number => {
  if (totalMoney > 0 && moneyBack > totalMoney * 1.05) {
    const corrected = moneyBack / 1000;
    const ratio = corrected / totalMoney;
    // Chỉ tự sửa khi sau khi chia 1000 số tiền hợp lệ (không vượt totalMoney).
    // Không đặt cận dưới cho tỷ lệ: lô ký gửi bán được ít vẫn có moneyBack thấp
    // (vd 8.184.400 so với total 49.040 → sau sửa 8.184,4 ≈ 17%, đúng thực tế;
    // cận dưới 20% trước đây khiến ký gửi 120-626 tháng 6/2026 bị tính 8,18
    // tỷ). Quét DB cũ: một số ký gửi 2022 vẫn không khớp, cần xem thủ công.
    if (ratio <= 1) return corrected;
  }
  return moneyBack;
};

/** Trả null nếu không đọc được thời điểm xác nhận trả tiền. */
export const derivePayout = (
  consignment: Parse.Object
): DerivedPayout | null => {
  const paidAtText = String(consignment.get('timeConfirmGetMoney') || '');
  const paidAt = parseDayMonthYear(paidAtText);
  if (!paidAt) return null;

  const banks = consignment.get('banks');
  const firstBank = Array.isArray(banks) ? banks[0] : undefined;
  const moneyBackK = safeMoneyBack(
    toNumber(consignment.get('moneyBack')),
    toNumber(consignment.get('totalMoney'))
  );

  return {
    id: consignment.id,
    consignmentId: String(consignment.get('consignmentId') || consignment.id),
    consignerName: String(consignment.get('consignerName') || '').trim(),
    phone: String(consignment.get('phoneNumber') || '').trim(),
    method:
      consignment.get('isTransferMoneyWithBank') === true ? 'bank' : 'cash',
    bankName: String(firstBank?.type || consignment.get('bankName') || ''),
    bankAccount: String(
      firstBank?.accNumber || consignment.get('bankId') || ''
    ).replace(/\s+/g, ''),
    moneyBackVnd: thousandsToVnd(moneyBackK),
    paidAt,
    paidAtText,
    markedBy: extractPaidMarker(consignment.get('note')),
  };
};

/** Che số tài khoản, chỉ giữ 4 số cuối. */
export const maskAccount = (account: string): string => {
  const digits = account.replace(/\s+/g, '');
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(Math.min(digits.length - 4, 6))}${digits.slice(-4)}`;
};
