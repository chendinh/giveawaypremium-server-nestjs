import { requireAdminRole } from '../../../common/require-admin';
import { getMonthRange } from '../../../common/vn-time';
import { getSepayConfig } from '../../../config/sepay.config';
import { fetchSepayTransactions } from '../../../external-services/sepay/sepay.client';
import { BankTransaction } from '../../../models/bank.transaction';
import logger from '../../../plugins/logger';
import { upsertBankTransactions } from '../../bank-transaction/upsert';
import {
  ORDER_SELECT_FIELDS,
  deriveOrder,
  thousandsToVnd,
  toNumber,
} from './derive';
import { BANK_MARGIN_MS, StoredAllocation } from './reconciliation';
import { invalidateSnapshotsNear } from './snapshot';

const MIN_TEXT_LENGTH = 3;
const MAX_TEXT_LENGTH = 300;
const MAX_TARGETS = 20;

type TargetType = 'order' | 'consignment';

interface LinkTarget {
  type: TargetType;
  id: string;
}

interface ResolvedTarget {
  id: string;
  label: string;
  expectedVnd: number;
}

interface HistoryEntry {
  at: string;
  byId: string;
  byName: string;
  action: 'link' | 'unlink';
  detail: string;
}

const validationError = (message: string): Parse.Error =>
  new Parse.Error(Parse.Error.VALIDATION_ERROR, message);

const displayName = (user: Parse.User): string =>
  String(user.get('fullName') || user.get('username') || '');

const cleanText = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);

const hasManualDecision = (tx: Parse.Object): boolean => {
  const allocations = tx.get('allocations');
  return (
    (Array.isArray(allocations) && allocations.length > 0) ||
    !!tx.get('explanation')
  );
};

const resolveOrders = async (ids: string[]): Promise<ResolvedTarget[]> => {
  const orders = await new Parse.Query('Order')
    .containedIn('objectId', ids)
    .doesNotExist('deletedAt')
    .select(ORDER_SELECT_FIELDS)
    .limit(MAX_TARGETS)
    .find({ useMasterKey: true });
  return orders.map(order => {
    const derived = deriveOrder(order);
    return { id: derived.id, label: derived.id, expectedVnd: derived.bankVnd };
  });
};

const resolveConsignments = async (
  ids: string[]
): Promise<ResolvedTarget[]> => {
  const consignments = await new Parse.Query('Consignment')
    .containedIn('objectId', ids)
    .doesNotExist('deletedAt')
    .select(['consignmentId', 'moneyBack'])
    .limit(MAX_TARGETS)
    .find({ useMasterKey: true });
  return consignments.map(c => ({
    id: c.id,
    label: String(c.get('consignmentId') || c.id),
    expectedVnd: thousandsToVnd(toNumber(c.get('moneyBack'))),
  }));
};

/**
 * Cloud Function: linkBankTransaction
 *
 * Gán thủ công một giao dịch ngân hàng chưa khớp vào đơn hàng (tiền vào) hoặc ký gửi
 * (tiền ra), và/hoặc ghi giải trình. Mọi thao tác được lưu vết (ai, lúc nào) và hiện
 * trên báo cáo, vì đây là chỗ duy nhất người dùng can thiệp được vào kết quả đối chiếu.
 *
 * Một giao dịch có thể gán cho nhiều đơn/ký gửi (chuyển gộp): số tiền được chia lần
 * lượt theo số cần có của từng mục, mục cuối nhận phần còn lại.
 */
export const linkBankTransaction = async (
  request: Parse.Cloud.FunctionRequest<{
    transactionId: string;
    targets?: LinkTarget[];
    note?: string;
  }>
): Promise<{ ok: true }> => {
  const admin = await requireAdminRole(request.user);
  const { transactionId } = request.params;
  const targets = request.params.targets ?? [];
  const note = cleanText(request.params.note);

  if (targets.length === 0 && note.length < MIN_TEXT_LENGTH) {
    throw validationError(
      'Chọn đơn/ký gửi cần gán hoặc nhập nội dung giải trình'
    );
  }
  if (targets.length > MAX_TARGETS) {
    throw validationError(
      `Chỉ gán tối đa ${MAX_TARGETS} mục cho một giao dịch`
    );
  }

  const tx = await new Parse.Query(BankTransaction).get(transactionId, {
    useMasterKey: true,
  });
  if (hasManualDecision(tx)) {
    throw validationError(
      'Giao dịch đã được gán hoặc giải trình. Hãy hủy gán trước khi gán lại.'
    );
  }

  const txType = tx.get('type') as 'in' | 'out';
  const expectedType: TargetType = txType === 'in' ? 'order' : 'consignment';
  if (targets.some(t => t.type !== expectedType)) {
    throw validationError(
      txType === 'in'
        ? 'Tiền vào chỉ gán được cho đơn hàng'
        : 'Tiền ra chỉ gán được cho ký gửi'
    );
  }

  const ids = Array.from(new Set(targets.map(t => String(t.id))));
  let resolved: ResolvedTarget[] = [];
  if (ids.length > 0) {
    const found =
      expectedType === 'order'
        ? await resolveOrders(ids)
        : await resolveConsignments(ids);
    if (found.length !== ids.length) {
      throw validationError('Có mục không tồn tại hoặc đã bị xoá');
    }
    // Giữ đúng thứ tự người dùng chọn
    resolved = ids.map(id => found.find(f => f.id === id) as ResolvedTarget);
  }

  let remaining = Number(tx.get('amountVnd')) || 0;
  const allocations: StoredAllocation[] = [];
  resolved.forEach((target, index) => {
    const isLast = index === resolved.length - 1;
    const amountVnd = isLast
      ? remaining
      : Math.min(remaining, target.expectedVnd);
    remaining -= amountVnd;
    if (amountVnd > 0) {
      allocations.push({
        type: expectedType,
        targetId: target.id,
        label: target.label,
        amountVnd,
      });
    }
  });

  const entry: HistoryEntry = {
    at: new Date().toISOString(),
    byId: admin.id,
    byName: displayName(admin),
    action: 'link',
    detail:
      (resolved.length > 0
        ? `Gán vào ${resolved.map(t => t.label).join(', ')}`
        : 'Giải trình') + (note ? `: ${note}` : ''),
  };

  await tx.save(
    {
      allocations,
      explanation: note || null,
      linkedById: admin.id,
      linkedByName: displayName(admin),
      linkedAt: new Date(),
      history: [...((tx.get('history') as HistoryEntry[]) ?? []), entry],
    },
    { useMasterKey: true }
  );
  await invalidateSnapshotsNear(tx.get('occurredAt') as Date, BANK_MARGIN_MS);
  return { ok: true };
};

/** Cloud Function: unlinkBankTransaction — huỷ gán/giải trình, bắt buộc có lý do, giữ lại vết. */
export const unlinkBankTransaction = async (
  request: Parse.Cloud.FunctionRequest<{
    transactionId: string;
    reason: string;
  }>
): Promise<{ ok: true }> => {
  const admin = await requireAdminRole(request.user);
  const { transactionId } = request.params;
  const reason = cleanText(request.params.reason);

  if (reason.length < MIN_TEXT_LENGTH) {
    throw validationError('Vui lòng nhập lý do huỷ gán');
  }

  const tx = await new Parse.Query(BankTransaction).get(transactionId, {
    useMasterKey: true,
  });
  if (!hasManualDecision(tx)) {
    throw validationError('Giao dịch này chưa được gán hay giải trình');
  }

  const previous = ((tx.get('allocations') as StoredAllocation[]) ?? [])
    .map(a => a.label)
    .join(', ');
  const entry: HistoryEntry = {
    at: new Date().toISOString(),
    byId: admin.id,
    byName: displayName(admin),
    action: 'unlink',
    detail: `Huỷ ${previous ? `gán ${previous}` : 'giải trình'}: ${reason}`,
  };

  await tx.save(
    {
      allocations: [],
      explanation: null,
      linkedById: null,
      linkedByName: null,
      linkedAt: null,
      history: [...((tx.get('history') as HistoryEntry[]) ?? []), entry],
    },
    { useMasterKey: true }
  );
  await invalidateSnapshotsNear(tx.get('occurredAt') as Date, BANK_MARGIN_MS);
  return { ok: true };
};

/**
 * Cloud Function: syncSepayTransactions
 *
 * Kéo giao dịch của tháng (cộng phần đệm hai đầu) từ SePay API v2 và nạp vào DB.
 * Dùng để bù dữ liệu cho giai đoạn trước khi cấu hình webhook (webhook chỉ gửi giao
 * dịch phát sinh sau khi bật) hoặc khi webhook bị lỡ. An toàn khi chạy lặp lại.
 */
export const syncSepayTransactions = async (
  request: Parse.Cloud.FunctionRequest<{ month: string }>
): Promise<{
  fetched: number;
  kept: number;
  inserted: number;
  existing: number;
}> => {
  await requireAdminRole(request.user);
  const { month } = request.params;

  const cfg = getSepayConfig();
  if (!cfg.apiToken) {
    throw new Parse.Error(
      Parse.Error.SCRIPT_FAILED,
      'Server chưa cấu hình SEPAY_API_TOKEN nên không đồng bộ được từ SePay'
    );
  }

  const { from, to } = getMonthRange(month);
  let fetched;
  try {
    fetched = await fetchSepayTransactions({
      from: new Date(from.getTime() - BANK_MARGIN_MS),
      to: new Date(to.getTime() + BANK_MARGIN_MS - 1000),
    });
  } catch (err) {
    logger.error(
      `[SePay] Đồng bộ tháng ${month} lỗi: ${(err as Error).message}`
    );
    throw new Parse.Error(Parse.Error.SCRIPT_FAILED, (err as Error).message);
  }

  const kept =
    cfg.accountNumbers.length > 0
      ? fetched.filter(tx => cfg.accountNumbers.includes(tx.accountNumber))
      : fetched;
  const { inserted, existing } = await upsertBankTransactions(kept);

  logger.info(
    `[SePay] Đồng bộ tháng ${month}: lấy ${fetched.length}, giữ ${kept.length}, mới ${inserted}, đã có ${existing}`
  );
  return { fetched: fetched.length, kept: kept.length, inserted, existing };
};
