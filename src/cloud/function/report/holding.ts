import { getMonthRange } from '../../../common/vn-time';
import { getSepayConfig } from '../../../config/sepay.config';
import { fetchSepayBankAccounts } from '../../../external-services/sepay/sepay.client';
import { BankTransaction } from '../../../models/bank.transaction';
import logger from '../../../plugins/logger';
import { thousandsToVnd, toNumber } from './derive';
import { HoldingAccountDto, HoldingDto } from './types';

const FETCH_OPTIONS = { useMasterKey: true, batchSize: 1000 } as const;

/**
 * Mốc bắt đầu theo dõi "chưa trả khách" — quyết định nghiệp vụ: dữ liệu ký gửi
 * trước tháng 10/2026 không còn được tính vào nữa (không rà soát, không hiển
 * thị). Từng có ký gửi từ 2021 bị nhập sai đơn vị giá (lệch 1000 lần) khiến tổng
 * "chưa trả" cộng dồn theo lịch sử lên tới hàng nghìn tỷ — thay vì dò từng bản ghi
 * cũ, chủ shop chọn chốt mốc mới, bỏ hẳn dữ liệu trước đó.
 */
export const UNPAID_TRACKING_START = getMonthRange('2026-10').from;

/**
 * Ký gửi đã bán nhưng CHƯA được đánh dấu đã trả, tính từ UNPAID_TRACKING_START —
 * đây là công nợ còn treo tới hiện tại (shop thường 1–2 tháng mới trả một lần).
 */
const loadUnpaidToConsigners = async (): Promise<{
  count: number;
  totalVnd: number;
}> => {
  const query = new Parse.Query('Consignment');
  query.doesNotExist('deletedAt');
  query.notEqualTo('isGetMoney', true);
  query.greaterThan('moneyBack', 0);
  query.greaterThanOrEqualTo('createdAt', UNPAID_TRACKING_START);
  query.select(['moneyBack']);
  const consignments = await query.findAll(FETCH_OPTIONS);

  return {
    count: consignments.length,
    totalVnd: consignments.reduce(
      (sum, c) => sum + thousandsToVnd(toNumber(c.get('moneyBack'))),
      0
    ),
  };
};

/**
 * Số dư gần đúng suy từ giao dịch ngân hàng gần nhất đã đồng bộ được — chỉ dùng
 * khi không gọi được SePay API trực tiếp. Có thể thiếu chính xác vì một số ngân
 * hàng không báo số dư qua SMS (SePay trả 0 trong trường hợp đó) hoặc do lịch sử
 * giao dịch local chưa đồng bộ đủ mới.
 */
const loadFallbackBalances = async (
  accountNumbers: string[]
): Promise<{ accounts: HoldingAccountDto[]; asOf: Date | null }> => {
  const query = new Parse.Query(BankTransaction);
  if (accountNumbers.length > 0) {
    query.containedIn('accountNumber', accountNumbers);
  }
  query.greaterThan('accumulatedVnd', 0);
  query.descending('occurredAt');
  query.select(['accountNumber', 'bankName', 'accumulatedVnd', 'occurredAt']);
  query.limit(200);
  const rows = await query.find({ useMasterKey: true });

  const latestByAccount = new Map<string, Parse.Object>();
  for (const row of rows) {
    const accountNumber = row.get('accountNumber') as string;
    if (!latestByAccount.has(accountNumber)) {
      latestByAccount.set(accountNumber, row);
    }
  }

  const accounts: HoldingAccountDto[] = Array.from(
    latestByAccount.values()
  ).map(row => ({
    accountNumber: row.get('accountNumber') as string,
    bankName: String(row.get('bankName') || ''),
    balanceVnd: Number(row.get('accumulatedVnd')) || 0,
  }));
  const asOf = rows.length > 0 ? (rows[0].get('occurredAt') as Date) : null;
  return { accounts, asOf };
};

/**
 * "Tiền shop đang giữ" — số dư ngân hàng hiện tại, đối chiếu với số tiền còn phải
 * trả khách ký gửi (chưa đánh dấu đã trả, từ UNPAID_TRACKING_START). Phần dư ra
 * (surplus) mới là tiền thực sự thuộc về shop; phần còn lại vẫn là tiền của khách
 * mà shop đang tạm giữ, sẽ phải chi ra khi đến kỳ trả.
 */
export const buildHolding = async (): Promise<HoldingDto> => {
  const unpaid = await loadUnpaidToConsigners();
  const cfg = getSepayConfig();
  const base = {
    unpaidToConsignersVnd: unpaid.totalVnd,
    unpaidConsignmentCount: unpaid.count,
  };

  if (cfg.apiToken) {
    try {
      const accounts = await fetchSepayBankAccounts();
      const kept =
        cfg.accountNumbers.length > 0
          ? accounts.filter(a => cfg.accountNumbers.includes(a.accountNumber))
          : accounts;
      const bankBalanceVnd = kept.reduce((sum, a) => sum + a.balanceVnd, 0);
      return {
        ...base,
        bankBalanceVnd,
        balanceSource: 'api',
        asOf: new Date().toISOString(),
        accounts: kept,
        surplusVnd: bankBalanceVnd - unpaid.totalVnd,
      };
    } catch (err) {
      logger.warn(
        `[Holding] Không lấy được số dư từ SePay API: ${(err as Error).message}`
      );
      // rơi xuống fallback bên dưới
    }
  }

  const fallback = await loadFallbackBalances(cfg.accountNumbers);
  if (fallback.accounts.length > 0) {
    const bankBalanceVnd = fallback.accounts.reduce(
      (sum, a) => sum + a.balanceVnd,
      0
    );
    return {
      ...base,
      bankBalanceVnd,
      balanceSource: 'last_transaction',
      asOf: fallback.asOf ? fallback.asOf.toISOString() : null,
      accounts: fallback.accounts,
      surplusVnd: bankBalanceVnd - unpaid.totalVnd,
      warning:
        'Không gọi được SePay API, đang hiển thị số dư theo giao dịch gần nhất đã ghi nhận — có thể chưa đầy đủ.',
    };
  }

  return {
    ...base,
    bankBalanceVnd: null,
    balanceSource: 'unavailable',
    asOf: null,
    accounts: [],
    surplusVnd: null,
    warning: cfg.apiToken
      ? 'Không lấy được số dư ngân hàng từ SePay.'
      : 'Chưa cấu hình SEPAY_API_TOKEN nên không lấy được số dư ngân hàng hiện tại.',
  };
};
