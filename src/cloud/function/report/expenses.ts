import {
  requireAdminRole,
  requireReportViewerRole,
} from '../../../common/require-admin';
import { MonthlyExpense } from '../../../models/monthly.expense';

const MAX_ITEMS = 50;
const MAX_LABEL_LENGTH = 100;
const MAX_NOTE_LENGTH = 300;

export interface ExpenseItemInput {
  id?: string;
  label: string;
  amountVnd: number;
  note?: string;
}

export interface ExpenseItemDto {
  id: string;
  label: string;
  amountVnd: number;
  note: string;
}

export interface MonthlyExpensesDto {
  month: string;
  items: ExpenseItemDto[];
  totalVnd: number;
  updatedByName: string | null;
  updatedAt: string | null;
}

interface ExpenseHistoryEntry {
  at: string;
  byId: string;
  byName: string;
  totalVnd: number;
  itemCount: number;
}

const emptyDto = (month: string): MonthlyExpensesDto => ({
  month,
  items: [],
  totalVnd: 0,
  updatedByName: null,
  updatedAt: null,
});

const toDto = (obj: Parse.Object): MonthlyExpensesDto => ({
  month: String(obj.get('month')),
  items: (obj.get('items') as ExpenseItemDto[]) ?? [],
  totalVnd: Number(obj.get('totalVnd')) || 0,
  updatedByName: obj.get('updatedByName') || null,
  updatedAt: obj.updatedAt ? obj.updatedAt.toISOString() : null,
});

const findByMonth = (month: string): Promise<Parse.Object | undefined> =>
  new Parse.Query(MonthlyExpense)
    .equalTo('month', month)
    .first({ useMasterKey: true });

/** Dùng nội bộ (getMonthlyReport) — không kiểm tra quyền, không lỗi nếu chưa có dữ liệu. */
export const getMonthlyExpensesInternal = async (
  month: string
): Promise<MonthlyExpensesDto> => {
  const found = await findByMonth(month);
  return found ? toDto(found) : emptyDto(month);
};

/** Cloud Function: getMonthlyExpenses — đọc chi phí đã nhập của một tháng. */
export const getMonthlyExpenses = async (
  request: Parse.Cloud.FunctionRequest<{ month: string }>
): Promise<MonthlyExpensesDto> => {
  await requireReportViewerRole(request.user);
  return getMonthlyExpensesInternal(request.params.month);
};

const sanitizeItem = (
  raw: ExpenseItemInput,
  index: number,
  nextFallbackId: () => string
): ExpenseItemDto => {
  const label = String(raw?.label ?? '')
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
  if (!label) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      `Dòng chi phí thứ ${index + 1} thiếu tên`
    );
  }
  const amountVnd = Math.round(Number(raw?.amountVnd));
  if (!Number.isFinite(amountVnd) || amountVnd < 0) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      `Số tiền của "${label}" không hợp lệ`
    );
  }
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : nextFallbackId(),
    label,
    amountVnd,
    note: String(raw?.note ?? '')
      .trim()
      .slice(0, MAX_NOTE_LENGTH),
  };
};

/**
 * Cloud Function: saveMonthlyExpenses
 *
 * Lưu toàn bộ danh sách chi phí của một tháng (lương, điện nước, chi phí khác...).
 * Ghi đè toàn bộ `items` theo danh sách gửi lên — client luôn gửi đủ danh sách hiện
 * tại (thêm/sửa/xoá dòng đều phản ánh trong `items`). Mỗi lần lưu đều được thêm vào
 * `history` để biết ai đã sửa chi phí, lúc nào, tổng là bao nhiêu.
 */
export const saveMonthlyExpenses = async (
  request: Parse.Cloud.FunctionRequest<{
    month: string;
    items: ExpenseItemInput[];
  }>
): Promise<MonthlyExpensesDto> => {
  const admin = await requireAdminRole(request.user);
  const { month } = request.params;
  const rawItems = Array.isArray(request.params.items)
    ? request.params.items
    : [];

  if (rawItems.length > MAX_ITEMS) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      `Chỉ nhập tối đa ${MAX_ITEMS} dòng chi phí`
    );
  }

  let seq = 0;
  const items = rawItems.map((raw, index) =>
    sanitizeItem(raw, index, () => `exp_${Date.now()}_${seq++}`)
  );
  const totalVnd = items.reduce((sum, item) => sum + item.amountVnd, 0);
  const byName = String(admin.get('fullName') || admin.get('username') || '');

  const existing = await findByMonth(month);
  const target = existing ?? new MonthlyExpense();
  if (!existing) target.set('month', month);

  const historyEntry: ExpenseHistoryEntry = {
    at: new Date().toISOString(),
    byId: admin.id,
    byName,
    totalVnd,
    itemCount: items.length,
  };

  await target.save(
    {
      items,
      totalVnd,
      updatedById: admin.id,
      updatedByName: byName,
      history: [
        ...((target.get('history') as ExpenseHistoryEntry[]) ?? []),
        historyEntry,
      ],
    },
    { useMasterKey: true }
  );

  return toDto(target);
};
