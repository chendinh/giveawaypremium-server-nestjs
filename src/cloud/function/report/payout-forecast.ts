import { requireAdminRole } from '../../../common/require-admin';
import {
  currentVnMonth,
  getMonthRange,
  monthOfDate,
  parseDayMonthYear,
} from '../../../common/vn-time';
import { safeMoneyBack, thousandsToVnd, toNumber } from './derive';
import { UNPAID_TRACKING_START } from './holding';

const FETCH_OPTIONS = { useMasterKey: true, batchSize: 1000 } as const;

/** Số tháng phía trước (kể cả tháng hiện tại) đưa vào dự báo. */
const FORECAST_MONTHS = 4;

export interface PayoutForecastMonth {
  /** Tháng đến hạn trả, 'YYYY-MM' */
  month: string;
  consignmentCount: number;
  /** Phần đã bán tới hiện tại (moneyBack) — số chắc chắn phải trả khi đến hạn */
  soldVnd: number;
  /** Phần chưa bán (moneyBackForFullSold − moneyBack) — chỉ phải trả nếu bán thêm trước hạn */
  unsoldPotentialVnd: number;
}

/** Tiền hàng ĐÃ BÁN còn nợ khách ký gửi — số phải trả nếu shop đóng cửa ngay. */
export interface ClosureLiability {
  /** Mốc bắt đầu (ISO): chỉ tính ký gửi tạo từ đây */
  since: string;
  consignmentCount: number;
  totalVnd: number;
  /** Trong totalVnd, phần đã quá hạn trả (timeGetMoney đã qua) */
  overdueCount: number;
  overdueVnd: number;
  byCreatedMonth: Array<{ month: string; count: number; vnd: number }>;
}

export interface PayoutForecast {
  closure: ClosureLiability;
  generatedAt: string;
  /** Mốc bắt đầu theo dõi (ISO) — ký gửi tạo trước mốc này không tính */
  trackingStart: string;
  /** Đã quá hạn nhưng chưa đánh dấu đã trả */
  overdue: PayoutForecastMonth;
  months: PayoutForecastMonth[];
  /** Hạn trả xa hơn cửa sổ dự báo */
  later: PayoutForecastMonth;
}

const emptyBucket = (month: string): PayoutForecastMonth => ({
  month,
  consignmentCount: 0,
  soldVnd: 0,
  unsoldPotentialVnd: 0,
});

const addMonths = (month: string, n: number): string => {
  const [y, m] = month.split('-').map(Number);
  return monthOfDate(new Date(Date.UTC(y, m - 1 + n, 15)));
};

/**
 * Cloud Function: getPayoutForecast
 *
 * Ước tính tiền phải chi trả khách ký gửi theo THÁNG ĐẾN HẠN. Hạn trả là
 * Consignment.timeGetMoney ('dd-MM-yyyy', thường 2–3 tháng sau ngày ký gửi,
 * bất kể hàng đã bán hay chưa). Chỉ tính ký gửi chưa trả, tạo từ
 * UNPAID_TRACKING_START (cùng mốc với "chưa trả khách" ở holding.ts).
 */
export const getPayoutForecast = async (
  request: Parse.Cloud.FunctionRequest<{ since?: string }>
): Promise<PayoutForecast> => {
  await requireAdminRole(request.user);

  const since = request.params?.since
    ? getMonthRange(request.params.since).from
    : UNPAID_TRACKING_START;
  // Dự báo theo hạn dùng mốc nghiệp vụ; công nợ đóng cửa dùng mốc báo cáo (có thể sớm hơn)
  const trackingStart =
    since < UNPAID_TRACKING_START ? since : UNPAID_TRACKING_START;

  const query = new Parse.Query('Consignment');
  query.doesNotExist('deletedAt');
  query.notEqualTo('isGetMoney', true);
  query.greaterThanOrEqualTo('createdAt', trackingStart);
  query.select(['moneyBack', 'moneyBackForFullSold', 'totalMoney', 'timeGetMoney']);
  const consignments = await query.findAll(FETCH_OPTIONS);

  const current = currentVnMonth();
  const buckets = new Map<string, PayoutForecastMonth>();
  for (let i = 0; i < FORECAST_MONTHS; i++) {
    const month = addMonths(current, i);
    buckets.set(month, emptyBucket(month));
  }
  const overdue = emptyBucket('overdue');
  const later = emptyBucket('later');
  const currentStart = getMonthRange(current).from;

  const closure: ClosureLiability = {
    since: since.toISOString(),
    consignmentCount: 0,
    totalVnd: 0,
    overdueCount: 0,
    overdueVnd: 0,
    byCreatedMonth: [],
  };
  const byMonth = new Map<string, { count: number; vnd: number }>();
  const now = new Date();

  for (const c of consignments) {
    const created = c.createdAt as Date;
    const dueAt = parseDayMonthYear(String(c.get('timeGetMoney') || ''));
    const soldK = safeMoneyBack(
      toNumber(c.get('moneyBack')),
      toNumber(c.get('totalMoney'))
    );
    if (created >= since && soldK > 0) {
      const vnd = thousandsToVnd(soldK);
      closure.consignmentCount += 1;
      closure.totalVnd += vnd;
      if (dueAt && dueAt < now) {
        closure.overdueCount += 1;
        closure.overdueVnd += vnd;
      }
      const key = monthOfDate(created);
      const e = byMonth.get(key) ?? { count: 0, vnd: 0 };
      e.count += 1;
      e.vnd += vnd;
      byMonth.set(key, e);
    }
    // Phần dự báo theo hạn vẫn chỉ tính từ UNPAID_TRACKING_START
    if (created < UNPAID_TRACKING_START) continue;

    const due = dueAt;
    if (!due) continue;

    const total = toNumber(c.get('totalMoney'));
    const sold = safeMoneyBack(toNumber(c.get('moneyBack')), total);
    const full = Math.max(
      sold,
      safeMoneyBack(toNumber(c.get('moneyBackForFullSold')), total)
    );

    const target =
      due < currentStart
        ? overdue
        : (buckets.get(monthOfDate(due)) ?? later);
    target.consignmentCount += 1;
    target.soldVnd += thousandsToVnd(sold);
    target.unsoldPotentialVnd += thousandsToVnd(full - sold);
  }

  closure.byCreatedMonth = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  return {
    closure,
    generatedAt: new Date().toISOString(),
    trackingStart: UNPAID_TRACKING_START.toISOString(),
    overdue,
    months: Array.from(buckets.values()),
    later,
  };
};
