/**
 * Tách "Tiền trả khách ký gửi" (consignerShareVnd, tạm tính theo doanh số bán
 * TRONG THÁNG) thành 2 phần CỘNG LẠI ĐÚNG BẰNG số đó — không phải một số khác
 * lấy từ nguồn khác:
 *   - paidVnd    : trong số tiền phải trả cho hàng bán tháng này, phần nào
 *                  ký gửi tương ứng ĐÃ được đánh dấu "đã trả tiền" (tính đến
 *                  lúc xem báo cáo, có thể trả cùng tháng hoặc tháng sau).
 *   - unpaidVnd  : phần còn lại — khách THỰC TẾ CHƯA NHẬN, chỉ tính riêng cho
 *                  hàng bán trong tháng này (không phải công nợ lũy kế toàn bộ
 *                  lịch sử như holding.unpaidToConsignersVnd).
 *   - paidThisMonthVnd: trong paidVnd, phần nào được xác nhận "đã trả" CŨNG
 *                  rơi vào đúng tháng báo cáo (không phải trả muộn ở tháng sau).
 *
 * Cách tính: Order không lưu sẵn trạng thái đã trả theo từng sản phẩm, phải
 * lần theo productList[].consignment (pointer) → Consignment.isGetMoney +
 * timeConfirmGetMoney. Một Order có thể gồm nhiều sản phẩm của nhiều ký gửi
 * khác trạng thái nhau, nên tính theo TỶ LỆ giá trị (priceAfterFee × count)
 * giữa các sản phẩm đã trả / chưa trả trong productList, rồi áp tỷ lệ đó vào
 * đúng consignerShareVnd của order (để tổng paidVnd + unpaidVnd luôn khớp
 * chính xác consignerShareVnd, không lệch do công thức fallback khác).
 */

interface ProductListItem {
  count?: number;
  priceAfterFee?: number;
  consignment?: { objectId?: string } | null;
}

export interface ConsignmentPaidStatus {
  isPaid: boolean;
  /** true nếu "đã trả" được xác nhận trong CÙNG tháng báo cáo */
  paidThisMonth: boolean;
}

export interface OrderForBreakdown {
  consignerShareVnd: number;
  productList: ProductListItem[] | undefined;
}

export interface ConsignerShareBreakdown {
  totalVnd: number;
  paidVnd: number;
  paidThisMonthVnd: number;
  unpaidVnd: number;
  /** Số đơn không lần được trạng thái trả (thiếu productList/consignment) — tạm coi là chưa trả */
  unresolvedOrderCount: number;
}

/** Lấy toàn bộ consignment objectId xuất hiện trong productList của các đơn. */
export const collectConsignmentIds = (
  orders: OrderForBreakdown[]
): string[] => {
  const ids = new Set<string>();
  for (const order of orders) {
    for (const item of order.productList || []) {
      const id = item.consignment?.objectId;
      if (id) ids.add(id);
    }
  }
  return Array.from(ids);
};

export const computeConsignerShareBreakdown = (
  orders: OrderForBreakdown[],
  statusById: Map<string, ConsignmentPaidStatus>
): ConsignerShareBreakdown => {
  let totalVnd = 0;
  let paidVnd = 0;
  let paidThisMonthVnd = 0;
  let unresolvedOrderCount = 0;

  for (const order of orders) {
    totalVnd += order.consignerShareVnd;

    const items = order.productList || [];
    let itemTotal = 0;
    let itemPaid = 0;
    let itemPaidThisMonth = 0;
    for (const item of items) {
      const value = (item.count || 1) * (item.priceAfterFee || 0);
      itemTotal += value;
      const status = item.consignment?.objectId
        ? statusById.get(item.consignment.objectId)
        : undefined;
      if (status?.isPaid) {
        itemPaid += value;
        if (status.paidThisMonth) itemPaidThisMonth += value;
      }
    }

    if (itemTotal <= 0) {
      // Không có productList hoặc không có giá trị nào đọc được — không lần ra
      // được trạng thái, coi toàn bộ phần của đơn này là chưa trả (an toàn hơn
      // là nhận nhầm đã trả).
      unresolvedOrderCount += 1;
      continue;
    }

    // Áp tỷ lệ đã trả/chưa trả (theo productList) vào đúng consignerShareVnd
    // thật của order, để tổng paid+unpaid luôn khớp totalVnd chính xác.
    const paidRatio = itemPaid / itemTotal;
    const paidThisMonthRatio = itemPaid > 0 ? itemPaidThisMonth / itemPaid : 0;
    const orderPaid = order.consignerShareVnd * paidRatio;
    paidVnd += orderPaid;
    paidThisMonthVnd += orderPaid * paidThisMonthRatio;
  }

  return {
    totalVnd: Math.round(totalVnd),
    paidVnd: Math.round(paidVnd),
    paidThisMonthVnd: Math.round(paidThisMonthVnd),
    unpaidVnd: Math.round(totalVnd - paidVnd),
    unresolvedOrderCount,
  };
};

// ─── Nguồn gốc của tiền ĐÃ CHUYỂN thực tế trong tháng ────────────────────────
//
// Khác hẳn breakdown ở trên (đó là tách consignerShareVnd — nghĩa vụ TẠM TÍNH
// theo hàng BÁN trong tháng). Ở đây là chiều ngược lại: trong số tiền THỰC TẾ
// đã rời quỹ tháng này (payouts.summary.totalVnd, mỗi payout = 1 ký gửi được
// bấm "đã trả tiền"), bao nhiêu là trả cho hàng ĐÃ BÁN ngay trong tháng này,
// bao nhiêu là trả cho hàng đã bán ở THÁNG KHÁC (ký gửi thường bán rải nhiều
// tháng rồi mới quyết toán 1 lần). Một ký gửi (Consignment) có thể có nhiều
// sản phẩm bán ở nhiều tháng khác nhau, nên phải tra toàn bộ lịch sử Order có
// chứa ký gửi đó để biết tỷ lệ giá trị bán tháng này / tháng khác, rồi áp tỷ
// lệ đó vào đúng moneyBackVnd thật của từng payout.

export interface PayoutForOrigin {
  consignmentId: string;
  moneyBackVnd: number;
}

/** 1 dòng lịch sử bán của 1 sản phẩm thuộc ký gửi, dùng để chia theo tháng. */
export interface ConsignmentSaleHistoryItem {
  consignmentId: string;
  valueVnd: number;
  soldInReportMonth: boolean;
}

export interface PayoutOriginBreakdown {
  totalVnd: number;
  /** Trả cho hàng bán TRONG tháng này */
  forThisMonthSalesVnd: number;
  /** Trả cho hàng bán ở THÁNG KHÁC (không phải do bán được tháng này) */
  forOtherMonthSalesVnd: number;
  /** Số payout không lần được lịch sử bán (coi là "tháng khác" — an toàn hơn nhận nhầm tháng này) */
  unresolvedPayoutCount: number;
}

export const computePayoutOriginBreakdown = (
  payouts: PayoutForOrigin[],
  saleHistory: ConsignmentSaleHistoryItem[]
): PayoutOriginBreakdown => {
  const byConsignment = new Map<
    string,
    { thisMonthVnd: number; otherMonthVnd: number }
  >();
  for (const row of saleHistory) {
    const entry = byConsignment.get(row.consignmentId) || {
      thisMonthVnd: 0,
      otherMonthVnd: 0,
    };
    if (row.soldInReportMonth) entry.thisMonthVnd += row.valueVnd;
    else entry.otherMonthVnd += row.valueVnd;
    byConsignment.set(row.consignmentId, entry);
  }

  let totalVnd = 0;
  let forThisMonthSalesVnd = 0;
  let unresolvedPayoutCount = 0;

  for (const payout of payouts) {
    totalVnd += payout.moneyBackVnd;
    const entry = byConsignment.get(payout.consignmentId);
    const sum = entry ? entry.thisMonthVnd + entry.otherMonthVnd : 0;
    if (!entry || sum <= 0) {
      // Không lần ra được lịch sử bán của ký gửi này — coi là "tháng khác"
      // (an toàn hơn là nhận nhầm thành "do bán tháng này").
      unresolvedPayoutCount += 1;
      continue;
    }
    const ratioThisMonth = entry.thisMonthVnd / sum;
    forThisMonthSalesVnd += payout.moneyBackVnd * ratioThisMonth;
  }

  return {
    totalVnd: Math.round(totalVnd),
    forThisMonthSalesVnd: Math.round(forThisMonthSalesVnd),
    forOtherMonthSalesVnd: Math.round(totalVnd - forThisMonthSalesVnd),
    unresolvedPayoutCount,
  };
};
