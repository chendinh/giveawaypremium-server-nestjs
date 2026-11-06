import { getSepayConfig } from '../../../config/sepay.config';
import { BankTransaction } from '../../../models/bank.transaction';
import { DerivedOrder, DerivedPayout, maskAccount } from './derive';
import {
  AMOUNT_TOLERANCE_VND,
  BankTxItem,
  ExpectedItem,
  ManualAllocation,
  MatchAllocation,
  TargetStatus,
  buildAccountPattern,
  buildCodePattern,
  buildPhonePattern,
  classifyTarget,
  matchTransactions,
  normalizeText,
} from './matcher';
import {
  MatchSource,
  ReconOrderItemDto,
  ReconPayoutItemDto,
  ReconSideSummary,
  ReconTxDto,
  ReconTxStatus,
  ReconTxTarget,
  ReconciliationDto,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Phần đệm hai đầu tháng khi nạp giao dịch ngân hàng, để ghép được các đơn/khoản
 * sát ranh giới tháng (tiền về trước khi lên đơn, trả khách lệch vài ngày).
 */
export const BANK_MARGIN_MS = 8 * DAY_MS;

export interface StoredAllocation {
  type: 'order' | 'consignment';
  targetId: string;
  label: string;
  amountVnd: number;
}

interface LoadedTx {
  id: string;
  fingerprint: string;
  createdAtMs: number;
  type: 'in' | 'out';
  amountVnd: number;
  at: Date;
  bankName: string;
  accountNumber: string;
  content: string;
  description: string;
  referenceCode: string;
  allocations: StoredAllocation[];
  explanation: string | null;
  linkedByName: string | null;
  linkedAt: Date | null;
}

const parseStoredAllocations = (value: unknown): StoredAllocation[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item.targetId === 'string')
    .map(item => ({
      type: item.type === 'consignment' ? 'consignment' : 'order',
      targetId: item.targetId,
      label: String(item.label || item.targetId),
      amountVnd: Number(item.amountVnd) || 0,
    }));
};

const loadBankTransactions = async (
  from: Date,
  to: Date
): Promise<LoadedTx[]> => {
  const query = new Parse.Query(BankTransaction);
  query.greaterThanOrEqualTo(
    'occurredAt',
    new Date(from.getTime() - BANK_MARGIN_MS)
  );
  query.lessThan('occurredAt', new Date(to.getTime() + BANK_MARGIN_MS));
  query.select([
    'fingerprint',
    'type',
    'amountVnd',
    'occurredAt',
    'bankName',
    'accountNumber',
    'content',
    'description',
    'referenceCode',
    'allocations',
    'explanation',
    'linkedByName',
    'linkedAt',
  ]);
  const rows = await query.findAll({ useMasterKey: true, batchSize: 1000 });

  // Loại trùng theo fingerprint (phòng khi webhook + đồng bộ API ghi trùng giữa
  // nhiều tiến trình): giữ bản ghi tạo sớm nhất.
  const byFingerprint = new Map<string, LoadedTx>();
  for (const row of rows) {
    const tx: LoadedTx = {
      id: row.id,
      fingerprint: row.get('fingerprint') as string,
      createdAtMs: row.createdAt.getTime(),
      type: row.get('type') === 'out' ? 'out' : 'in',
      amountVnd: Number(row.get('amountVnd')) || 0,
      at: row.get('occurredAt') as Date,
      bankName: String(row.get('bankName') || ''),
      accountNumber: String(row.get('accountNumber') || ''),
      content: String(row.get('content') || ''),
      description: String(row.get('description') || ''),
      referenceCode: String(row.get('referenceCode') || ''),
      allocations: parseStoredAllocations(row.get('allocations')),
      explanation: row.get('explanation')
        ? String(row.get('explanation'))
        : null,
      linkedByName: row.get('linkedByName') || null,
      linkedAt: (row.get('linkedAt') as Date | undefined) ?? null,
    };
    const current = byFingerprint.get(tx.fingerprint);
    if (!current || tx.createdAtMs < current.createdAtMs) {
      byFingerprint.set(tx.fingerprint, tx);
    }
  }
  return Array.from(byFingerprint.values()).sort(
    (a, b) => a.at.getTime() - b.at.getTime()
  );
};

// ─── Dựng kết quả cho một chiều (in / out) ────────────────────────────────────

interface TargetMeta {
  type: 'order' | 'consignment';
  label: string;
}

interface SideResult {
  allocByTarget: Map<string, MatchAllocation[]>;
  statusByTarget: Map<string, TargetStatus>;
  allocatedByTarget: Map<string, number>;
  transactions: ReconTxDto[];
}

const pushTo = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const runSide = (params: {
  direction: 'in' | 'out';
  targets: ExpectedItem[];
  meta: Map<string, TargetMeta>;
  txs: LoadedTx[];
  from: Date;
  to: Date;
}): SideResult => {
  const { direction, targets, meta, txs, from, to } = params;

  const txItems: BankTxItem[] = txs.map(tx => ({
    id: tx.id,
    amountVnd: tx.amountVnd,
    at: tx.at,
    haystack: normalizeText(`${tx.content} ${tx.description}`),
  }));

  // Quyết định thủ công đã lưu: có phân bổ → gán; chỉ có giải trình → chốt, không gán
  const manual = new Map<string, ManualAllocation[]>();
  for (const tx of txs) {
    if (tx.allocations.length > 0) {
      manual.set(
        tx.id,
        tx.allocations.map(a => ({
          targetId: a.targetId,
          amountVnd: a.amountVnd,
        }))
      );
    } else if (tx.explanation) {
      manual.set(tx.id, []);
    }
  }

  const allocations = matchTransactions({
    direction,
    targets,
    txs: txItems,
    manual,
  });

  const allocByTarget = new Map<string, MatchAllocation[]>();
  const allocByTx = new Map<string, MatchAllocation[]>();
  for (const alloc of allocations) {
    pushTo(allocByTarget, alloc.targetId, alloc);
    pushTo(allocByTx, alloc.txId, alloc);
  }

  const allocatedByTarget = new Map<string, number>();
  const statusByTarget = new Map<string, TargetStatus>();
  for (const target of targets) {
    const allocated = (allocByTarget.get(target.id) ?? []).reduce(
      (sum, a) => sum + a.amountVnd,
      0
    );
    allocatedByTarget.set(target.id, allocated);
    statusByTarget.set(
      target.id,
      classifyTarget(target.expectedVnd, allocated)
    );
  }

  const transactions: ReconTxDto[] = txs.map(tx => {
    const allocs = allocByTx.get(tx.id) ?? [];
    let status: ReconTxStatus;
    if (allocs.length === 0) {
      status = tx.explanation ? 'explained' : 'unmatched';
    } else {
      // Khoản không nằm trong tập đang đối chiếu (gán thủ công sang tháng khác)
      // không đánh giá được → coi là khớp.
      status = allocs.every(
        a => (statusByTarget.get(a.targetId) ?? 'matched') === 'matched'
      )
        ? 'matched'
        : 'mismatch';
    }

    const source: MatchSource | null = allocs.some(a => a.source === 'manual')
      ? 'manual'
      : allocs.length > 0
        ? 'auto'
        : tx.explanation
          ? 'manual'
          : null;

    const targetsDto: ReconTxTarget[] = allocs.map(a => {
      const stored = tx.allocations.find(s => s.targetId === a.targetId);
      const info = meta.get(a.targetId);
      return {
        type:
          info?.type ??
          stored?.type ??
          (direction === 'in' ? 'order' : 'consignment'),
        id: a.targetId,
        label: info?.label ?? stored?.label ?? a.targetId,
        amountVnd: a.amountVnd,
      };
    });

    return {
      id: tx.id,
      type: direction,
      at: tx.at.toISOString(),
      inMonth: tx.at >= from && tx.at < to,
      amountVnd: tx.amountVnd,
      bankName: tx.bankName,
      accountMasked: maskAccount(tx.accountNumber),
      content: tx.content,
      referenceCode: tx.referenceCode,
      status,
      source,
      targets: targetsDto,
      explanation: tx.explanation,
      linkedByName: tx.linkedByName,
      linkedAt: tx.linkedAt ? tx.linkedAt.toISOString() : null,
    };
  });

  return { allocByTarget, statusByTarget, allocatedByTarget, transactions };
};

const sourceOf = (
  allocs: MatchAllocation[] | undefined
): MatchSource | null => {
  if (!allocs || allocs.length === 0) return null;
  return allocs.some(a => a.source === 'manual') ? 'manual' : 'auto';
};

const summarize = (
  items: Array<{
    expectedVnd: number;
    allocatedVnd: number;
    diffVnd: number;
    status: TargetStatus;
  }>,
  transactions: ReconTxDto[]
): ReconSideSummary => {
  const inMonth = transactions.filter(t => t.inMonth);
  const unmatched = inMonth.filter(t => t.status === 'unmatched');
  const mismatch = items.filter(i => i.status === 'mismatch');
  const missing = items.filter(i => i.status === 'missing');
  const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

  return {
    expectedVnd: sum(items.map(i => i.expectedVnd)),
    allocatedVnd: sum(items.map(i => i.allocatedVnd)),
    bankTotalVnd: sum(inMonth.map(t => t.amountVnd)),
    bankCount: inMonth.length,
    matchedCount: items.filter(i => i.status === 'matched').length,
    mismatchCount: mismatch.length,
    missingCount: missing.length,
    missingVnd: sum(missing.map(i => i.expectedVnd)),
    shortVnd: sum(mismatch.map(i => Math.max(0, -i.diffVnd))),
    excessVnd: sum(mismatch.map(i => Math.max(0, i.diffVnd))),
    unmatchedTxCount: unmatched.length,
    unmatchedTxVnd: sum(unmatched.map(t => t.amountVnd)),
    explainedTxCount: inMonth.filter(t => t.status === 'explained').length,
  };
};

/**
 * Đối chiếu dữ liệu hệ thống với giao dịch ngân hàng SePay của tháng báo cáo.
 * Tính lại mỗi lần gọi từ dữ liệu hiện tại — không lưu kết quả — nên luôn phản ánh
 * đúng đơn/ký gửi và sao kê tại thời điểm xem.
 */
export const buildReconciliation = async (input: {
  from: Date;
  to: Date;
  orders: DerivedOrder[];
  payouts: DerivedPayout[];
  staffNames: Map<string, string>;
}): Promise<ReconciliationDto> => {
  const { from, to, orders, payouts, staffNames } = input;
  const cfg = getSepayConfig();
  const configured = {
    webhook: !!(cfg.webhookApiKey || cfg.webhookSecret),
    api: !!cfg.apiToken,
  };

  const lastTx = await new Parse.Query(BankTransaction)
    .descending('occurredAt')
    .select(['occurredAt'])
    .first({ useMasterKey: true });
  const lastTransactionAt = lastTx
    ? (lastTx.get('occurredAt') as Date).toISOString()
    : null;

  const loaded = await loadBankTransactions(from, to);
  if (loaded.length === 0) {
    return {
      configured,
      hasData: false,
      lastTransactionAt,
      inbound: null,
      outbound: null,
    };
  }

  // ── Tiền vào ↔ đơn hàng thu bằng chuyển khoản ──
  const bankOrders = orders.filter(o => o.bankVnd > AMOUNT_TOLERANCE_VND);
  const inSide = runSide({
    direction: 'in',
    targets: bankOrders.map(o => ({
      id: o.id,
      expectedVnd: o.bankVnd,
      at: o.createdAt,
      patterns: [buildPhonePattern(o.phone)].filter(
        (p): p is RegExp => p !== null
      ),
    })),
    meta: new Map(
      bankOrders.map(o => [o.id, { type: 'order' as const, label: o.id }])
    ),
    txs: loaded.filter(t => t.type === 'in'),
    from,
    to,
  });
  const inItems: ReconOrderItemDto[] = bankOrders.map(o => {
    const allocated = inSide.allocatedByTarget.get(o.id) ?? 0;
    const allocs = inSide.allocByTarget.get(o.id);
    return {
      id: o.id,
      at: o.createdAt.toISOString(),
      channel: o.channel,
      customerName: o.customerName,
      phone: o.phone,
      staffName: o.staffId ? (staffNames.get(o.staffId) ?? null) : null,
      moneyConfirmed: o.moneyConfirmed,
      expectedVnd: o.bankVnd,
      allocatedVnd: allocated,
      diffVnd: allocated - o.bankVnd,
      status: inSide.statusByTarget.get(o.id) ?? 'missing',
      source: sourceOf(allocs),
      txIds: (allocs ?? []).map(a => a.txId),
    };
  });

  // ── Tiền ra ↔ ký gửi đã trả bằng chuyển khoản ──
  const bankPayouts = payouts.filter(
    p => p.method === 'bank' && p.moneyBackVnd > AMOUNT_TOLERANCE_VND
  );
  const outSide = runSide({
    direction: 'out',
    targets: bankPayouts.map(p => ({
      id: p.id,
      expectedVnd: p.moneyBackVnd,
      at: p.paidAt,
      patterns: [
        buildCodePattern(p.consignmentId),
        buildAccountPattern(p.bankAccount),
      ].filter((pattern): pattern is RegExp => pattern !== null),
      nameKey: normalizeText(p.consignerName),
    })),
    meta: new Map(
      bankPayouts.map(p => [
        p.id,
        { type: 'consignment' as const, label: p.consignmentId },
      ])
    ),
    txs: loaded.filter(t => t.type === 'out'),
    from,
    to,
  });
  const outItems: ReconPayoutItemDto[] = bankPayouts.map(p => {
    const allocated = outSide.allocatedByTarget.get(p.id) ?? 0;
    const allocs = outSide.allocByTarget.get(p.id);
    return {
      id: p.id,
      consignmentId: p.consignmentId,
      consignerName: p.consignerName,
      bankName: p.bankName,
      accountMasked: maskAccount(p.bankAccount),
      paidAt: p.paidAt.toISOString(),
      markedBy: p.markedBy,
      expectedVnd: p.moneyBackVnd,
      allocatedVnd: allocated,
      diffVnd: allocated - p.moneyBackVnd,
      status: outSide.statusByTarget.get(p.id) ?? 'missing',
      source: sourceOf(allocs),
      txIds: (allocs ?? []).map(a => a.txId),
    };
  });

  return {
    configured,
    hasData: true,
    lastTransactionAt,
    inbound: {
      summary: summarize(inItems, inSide.transactions),
      items: inItems,
      transactions: inSide.transactions,
    },
    outbound: {
      summary: summarize(outItems, outSide.transactions),
      items: outItems,
      transactions: outSide.transactions,
    },
  };
};
