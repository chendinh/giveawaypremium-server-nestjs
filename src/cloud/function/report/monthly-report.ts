import { requireAdminRole } from '../../../common/require-admin';
import { getMonthRange, parseDayMonthYear } from '../../../common/vn-time';
import { getSepayConfig } from '../../../config/sepay.config';
import logger from '../../../plugins/logger';
import {
  DerivedOrder,
  DerivedPayout,
  ORDER_SELECT_FIELDS,
  PAYOUT_SELECT_FIELDS,
  deriveOrder,
  derivePayout,
  maskAccount,
  thousandsToVnd,
} from './derive';
import { getMonthlyExpensesInternal } from './expenses';
import { buildHolding } from './holding';
import {
  ConsignmentPaidStatus,
  ConsignmentSaleHistoryItem,
  collectConsignmentIds,
  computeConsignerShareBreakdown,
  computePayoutOriginBreakdown,
} from './payout-breakdown';
import { buildReconciliation } from './reconciliation';
import { isPastMonth, loadSnapshot, saveSnapshot } from './snapshot';
import {
  ChannelTotals,
  MonthlyReport,
  PayoutSummary,
  ReconciliationDto,
} from './types';

const FETCH_OPTIONS = { useMasterKey: true, batchSize: 1000 } as const;

const loadOrders = async (from: Date, to: Date): Promise<DerivedOrder[]> => {
  // Cùng cách chọn dữ liệu với getOrderSummary để hai màn hình ra cùng con số:
  // bỏ đơn đã xoá mềm, include('transporter') để kiểm tra vận đơn tồn tại thật.
  const query = new Parse.Query('Order');
  query.doesNotExist('deletedAt');
  query.greaterThanOrEqualTo('createdAt', from);
  query.lessThan('createdAt', to);
  query.select(ORDER_SELECT_FIELDS);
  query.include('transporter');
  const orders = await query.findAll(FETCH_OPTIONS);
  return orders
    .map(deriveOrder)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
};

/** Ký gửi được nhân viên bấm "đã trả tiền" trong tháng (theo timeConfirmGetMoney). */
const loadPayouts = async (month: string): Promise<DerivedPayout[]> => {
  const [year, mon] = month.split('-');
  const query = new Parse.Query('Consignment');
  query.doesNotExist('deletedAt');
  query.equalTo('isGetMoney', true);
  // timeConfirmGetMoney là chuỗi 'dd-MM-yyyy HH:mm' nên lọc tháng bằng regex
  query.matches('timeConfirmGetMoney', new RegExp(`^\\d{2}-${mon}-${year}`));
  query.select(PAYOUT_SELECT_FIELDS);
  const consignments = await query.findAll(FETCH_OPTIONS);
  return consignments
    .map(derivePayout)
    .filter((p): p is DerivedPayout => p !== null)
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
};

/**
 * Trạng thái "đã trả" hiện tại của các Consignment xuất hiện trong productList
 * của các đơn trong tháng — dùng để tách consignerShareVnd thành đã trả/chưa
 * trả (payout-breakdown.ts). `from`/`to` là khoảng tháng báo cáo, dùng để biết
 * phần "đã trả" có rơi đúng vào tháng này hay trả ở tháng khác.
 */
const loadConsignmentPaidStatus = async (
  ids: string[],
  from: Date,
  to: Date
): Promise<Map<string, ConsignmentPaidStatus>> => {
  const statusById = new Map<string, ConsignmentPaidStatus>();
  if (ids.length === 0) return statusById;

  const query = new Parse.Query('Consignment');
  query.containedIn('objectId', ids);
  query.select(['isGetMoney', 'timeConfirmGetMoney']);
  const consignments = await query.findAll(FETCH_OPTIONS);

  for (const c of consignments) {
    const isPaid = c.get('isGetMoney') === true;
    const paidAt = parseDayMonthYear(c.get('timeConfirmGetMoney'));
    statusById.set(c.id, {
      isPaid,
      paidThisMonth: isPaid && !!paidAt && paidAt >= from && paidAt < to,
    });
  }
  return statusById;
};

/**
 * Toàn bộ lịch sử bán (mọi thời điểm, không chỉ tháng báo cáo) của các ký gửi
 * đã liệt kê trong `consignmentIds` — dùng để biết một ký gửi được bán rải ra
 * những tháng nào, phục vụ tách "tiền đã chuyển tháng này" theo tháng bán
 * thực tế (payout-breakdown.ts#computePayoutOriginBreakdown). Một ký gửi có
 * thể bán nhiều sản phẩm ở nhiều Order, nhiều tháng khác nhau nên phải quét
 * theo `productList.consignment.objectId` (Mongo khớp phần tử trong mảng).
 */
const loadConsignmentSaleHistory = async (
  consignmentIds: string[],
  from: Date,
  to: Date
): Promise<ConsignmentSaleHistoryItem[]> => {
  if (consignmentIds.length === 0) return [];

  const subQueries = consignmentIds.map(id => {
    const q = new Parse.Query('Order');
    q.equalTo('productList.consignment.objectId', id);
    return q;
  });
  const query = Parse.Query.or(...subQueries);
  query.doesNotExist('deletedAt');
  query.select(['productList', 'createdAt']);
  const orders = await query.findAll(FETCH_OPTIONS);

  const idSet = new Set(consignmentIds);
  const history: ConsignmentSaleHistoryItem[] = [];
  for (const order of orders) {
    const createdAt = order.createdAt;
    const soldInReportMonth = createdAt >= from && createdAt < to;
    const items = (order.get('productList') || []) as Array<{
      count?: number;
      priceAfterFee?: number;
      consignment?: { objectId?: string };
    }>;
    for (const item of items) {
      const consignmentId = item.consignment?.objectId;
      if (!consignmentId || !idSet.has(consignmentId)) continue;
      const valueVnd = thousandsToVnd(
        (item.count || 1) * (item.priceAfterFee || 0)
      );
      history.push({ consignmentId, valueVnd, soldInReportMonth });
    }
  }
  return history;
};

const resolveUserNames = async (
  ids: string[]
): Promise<Map<string, string>> => {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const users = await new Parse.Query(Parse.User)
    .containedIn('objectId', ids)
    .select(['fullName', 'username'])
    .limit(1000)
    .find({ useMasterKey: true });
  for (const user of users) {
    names.set(
      user.id,
      String(user.get('fullName') || user.get('username') || '')
    );
  }
  return names;
};

const emptyTotals = (): ChannelTotals => ({
  orderCount: 0,
  productCount: 0,
  revenueVnd: 0,
  consignerShareVnd: 0,
  feeVnd: 0,
  bankVnd: 0,
  cashVnd: 0,
});

const addOrder = (totals: ChannelTotals, order: DerivedOrder): void => {
  totals.orderCount += 1;
  totals.productCount += order.productCount;
  totals.revenueVnd += order.revenueVnd;
  totals.consignerShareVnd += order.consignerShareVnd;
  totals.feeVnd += order.feeVnd;
  totals.bankVnd += order.bankVnd;
  totals.cashVnd += order.cashVnd;
};

const summarizePayouts = (payouts: DerivedPayout[]): PayoutSummary => {
  const summary: PayoutSummary = {
    bankCount: 0,
    bankVnd: 0,
    cashCount: 0,
    cashVnd: 0,
    totalVnd: 0,
  };
  for (const payout of payouts) {
    if (payout.method === 'bank') {
      summary.bankCount += 1;
      summary.bankVnd += payout.moneyBackVnd;
    } else {
      summary.cashCount += 1;
      summary.cashVnd += payout.moneyBackVnd;
    }
    summary.totalVnd += payout.moneyBackVnd;
  }
  return summary;
};

/**
 * Cloud Function: getMonthlyReport
 *
 * Báo cáo kiểm kê một tháng (giờ VN) gửi giám đốc.
 *
 * Mô hình ký gửi: shop không sở hữu hàng, chỉ ăn PHÍ trên phần hàng đã bán thực tế
 * (không phải trên toàn bộ lô ký gửi). Vì vậy:
 *   - revenueVnd (doanh thu)   = tiền hàng đã bán thực tế của đơn (Order.totalMoneyForSale)
 *   - consignerShareVnd        = phần phải trả lại khách ký gửi của đơn đó
 *   - feeVnd (lợi nhuận)       = revenueVnd − consignerShareVnd — đây là lợi nhuận
 *     CHÍNH của shop, tính theo đơn bán trong tháng (dồn tích), không phụ thuộc
 *     việc tiền đã thực trả cho khách ký gửi hay chưa (shop thường 1–2 tháng mới
 *     thanh toán một lần).
 *   - expenses/profit          = feeVnd (tổng tháng) − chi phí vận hành đã nhập
 *     (lương, điện nước, chi phí khác) = lợi nhuận sau chi phí.
 *   - holding                  = tiền shop đang giữ trong ngân hàng, đối chiếu với
 *     số còn phải trả khách ký gửi (không giới hạn theo tháng).
 *
 * Kèm theo: doanh thu chia theo online/offline × chuyển khoản/tiền mặt, chi tiết
 * từng đơn và từng khoản trả khách, đối chiếu với sao kê ngân hàng SePay.
 *
 * Quyền: chỉ role administrator.
 */
const computeMonthlyReport = async (
  month: string,
  admin: Parse.User
): Promise<MonthlyReport> => {
  const { from, to } = getMonthRange(month);

  const [orders, payouts, expenses, holding] = await Promise.all([
    loadOrders(from, to),
    loadPayouts(month),
    getMonthlyExpensesInternal(month),
    buildHolding(),
  ]);

  const staffIds = Array.from(
    new Set(orders.map(o => o.staffId).filter((id): id is string => !!id))
  );
  const consignmentIds = collectConsignmentIds(orders);
  // p.id = Parse objectId của Consignment (p.consignmentId chỉ là mã hiển thị,
  // không dùng để khớp pointer trong productList).
  const paidConsignmentIds = payouts.map(p => p.id);
  const [staffNames, consignmentPaidStatus, payoutSaleHistory] =
    await Promise.all([
      resolveUserNames(staffIds),
      loadConsignmentPaidStatus(consignmentIds, from, to),
      loadConsignmentSaleHistory(paidConsignmentIds, from, to),
    ]);
  const consignerShareBreakdown = computeConsignerShareBreakdown(
    orders,
    consignmentPaidStatus
  );
  const payoutOrigin = computePayoutOriginBreakdown(
    payouts.map(p => ({
      consignmentId: p.id,
      moneyBackVnd: p.moneyBackVnd,
    })),
    payoutSaleHistory
  );

  const online = emptyTotals();
  const offline = emptyTotals();
  const all = emptyTotals();
  for (const order of orders) {
    addOrder(order.channel === 'online' ? online : offline, order);
    addOrder(all, order);
  }

  let reconciliation: ReconciliationDto;
  try {
    reconciliation = await buildReconciliation({
      from,
      to,
      orders,
      payouts,
      staffNames,
    });
  } catch (err) {
    // Đối chiếu lỗi không được làm hỏng cả báo cáo doanh thu
    logger.error(
      `[MonthlyReport] Đối chiếu ngân hàng tháng ${month} lỗi: ${(err as Error)?.message || err}`
    );
    const cfg = getSepayConfig();
    reconciliation = {
      configured: {
        webhook: !!(cfg.webhookApiKey || cfg.webhookSecret),
        api: !!cfg.apiToken,
      },
      hasData: false,
      lastTransactionAt: null,
      error: 'Không đối chiếu được với dữ liệu ngân hàng. Xem log server.',
      inbound: null,
      outbound: null,
    };
  }

  return {
    month,
    from: from.toISOString(),
    to: to.toISOString(),
    generatedAt: new Date().toISOString(),
    generatedBy: String(admin.get('fullName') || admin.get('username') || ''),
    totals: { online, offline, all },
    orders: orders.map(o => ({
      id: o.id,
      createdAt: o.createdAt.toISOString(),
      channel: o.channel,
      pickup: o.pickup,
      customerName: o.customerName,
      phone: o.phone,
      staffName: o.staffId ? (staffNames.get(o.staffId) ?? null) : null,
      productCount: o.productCount,
      revenueVnd: o.revenueVnd,
      consignerShareVnd: o.consignerShareVnd,
      feeVnd: o.feeVnd,
      bankVnd: o.bankVnd,
      cashVnd: o.cashVnd,
      paymentGapVnd: o.paymentGapVnd,
    })),
    payouts: {
      rows: payouts.map(p => ({
        id: p.id,
        consignmentId: p.consignmentId,
        consignerName: p.consignerName,
        method: p.method,
        bankName: p.bankName,
        accountMasked: maskAccount(p.bankAccount),
        moneyBackVnd: p.moneyBackVnd,
        paidAt: p.paidAt.toISOString(),
        markedBy: p.markedBy,
      })),
      summary: summarizePayouts(payouts),
    },
    expenses,
    profit: {
      feeVnd: all.feeVnd,
      expensesVnd: expenses.totalVnd,
      netVnd: all.feeVnd - expenses.totalVnd,
    },
    consignerShareBreakdown,
    payoutOrigin,
    holding,
    quality: {
      paymentGapOrders: orders.filter(o => o.paymentGapVnd !== 0).length,
    },
    reconciliation,
  };
};

/**
 * Cloud Function: getMonthlyReport
 *
 * - Tháng hiện tại: luôn tính trực tiếp, không lưu (còn phát sinh đơn/giao dịch).
 * - Tháng đã qua: có bản lưu (MonthlyReportSnapshot) thì trả luôn, không tính lại;
 *   chưa có thì tính, lưu, rồi trả. `refresh: true` bỏ qua bản lưu và ghi đè bằng
 *   số mới tính (dùng khi dữ liệu gốc đã đổi, ví dụ vừa xác nhận trả tiền muộn).
 *
 * Chi phí vận hành luôn lấy trực tiếp (một truy vấn nhẹ) và tính lại lợi nhuận
 * sau chi phí, vì quản lý có thể sửa chi phí của tháng cũ bất cứ lúc nào.
 */
export const getMonthlyReport = async (
  request: Parse.Cloud.FunctionRequest<{ month: string; refresh?: boolean }>
): Promise<MonthlyReport> => {
  const admin = await requireAdminRole(request.user);
  const { month, refresh } = request.params;
  const cacheable = isPastMonth(month);

  if (cacheable && !refresh) {
    const stored = await loadSnapshot(month);
    if (stored) {
      const expenses = await getMonthlyExpensesInternal(month);
      const { report } = stored;
      return {
        ...report,
        expenses,
        profit: {
          ...report.profit,
          expensesVnd: expenses.totalVnd,
          netVnd: report.profit.feeVnd - expenses.totalVnd,
        },
        cache: { source: 'snapshot', savedAt: stored.savedAt.toISOString() },
      };
    }
  }

  const report = await computeMonthlyReport(month, admin);
  if (!cacheable) {
    return { ...report, cache: { source: 'live', savedAt: null } };
  }

  // Đối chiếu ngân hàng lỗi → báo cáo thiếu phần đối chiếu, không lưu để lần sau
  // tính lại thay vì "đóng băng" một bản khuyết.
  if (report.reconciliation.error) {
    return { ...report, cache: { source: 'live', savedAt: null } };
  }

  await saveSnapshot(
    month,
    report,
    String(admin.get('fullName') || admin.get('username') || '')
  );
  return {
    ...report,
    cache: { source: 'live', savedAt: new Date().toISOString() },
  };
};
