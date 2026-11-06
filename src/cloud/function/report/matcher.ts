/**
 * Ghép giao dịch ngân hàng (SePay) với các khoản mong đợi trong hệ thống.
 *
 *   in  : đơn hàng ghi nhận thu bằng chuyển khoản  ↔ tiền vào tài khoản
 *   out : ký gửi đã đánh dấu "đã trả" bằng chuyển khoản ↔ tiền ra khỏi tài khoản
 *
 * Module thuần (không đụng DB) để dễ kiểm thử. Quy tắc:
 *  1. Quyết định thủ công đã lưu luôn được giữ nguyên, auto-match không ghi đè.
 *  2. Lượt A: ghép 1-1 theo số tiền (sai lệch ≤ AMOUNT_TOLERANCE_VND) trong cửa sổ
 *     thời gian; ưu tiên nội dung chuyển khoản có chứa mã ký gửi/SĐT/số tài khoản,
 *     rồi đến tên, rồi đến độ gần về thời gian.
 *  3. Lượt B: giao dịch còn lại mà nội dung chứa định danh của đúng MỘT khoản mong
 *     đợi thì gán vào khoản đó dù lệch tiền (để lộ ra chuyển thiếu/thừa). Mơ hồ
 *     (khớp nhiều khoản) thì để nguyên chưa khớp.
 */

export const AMOUNT_TOLERANCE_VND = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cửa sổ thời gian cho lượt A: khách thường CK quanh lúc lên đơn; trả khách có thể lệch ngày. */
const WINDOW_MS = { in: 3 * DAY_MS, out: 7 * DAY_MS } as const;
/** Cửa sổ rộng hơn cho lượt B (đã có định danh trong nội dung nên đủ tin cậy). */
const IDENTIFIER_WINDOW_MS = 31 * DAY_MS;

export type MatchDirection = 'in' | 'out';
export type TargetStatus = 'matched' | 'mismatch' | 'missing';

export interface ExpectedItem {
  id: string;
  expectedVnd: number;
  /** Mốc thời gian tham chiếu (lúc tạo đơn / lúc đánh dấu đã trả) */
  at: Date;
  /** Mẫu nhận diện khoản này trong nội dung chuyển khoản */
  patterns: RegExp[];
  /** Tên đã chuẩn hoá, chỉ dùng để cộng điểm ưu tiên */
  nameKey?: string;
}

export interface BankTxItem {
  id: string;
  amountVnd: number;
  at: Date;
  /** Nội dung + mô tả đã chuẩn hoá bằng normalizeText */
  haystack: string;
}

export interface ManualAllocation {
  targetId: string;
  amountVnd: number;
}

export interface MatchAllocation {
  txId: string;
  targetId: string;
  amountVnd: number;
  source: 'auto' | 'manual';
}

// ─── Chuẩn hoá & mẫu nhận diện ────────────────────────────────────────────────

/** Bỏ dấu tiếng Việt, đổi sang chữ in hoa: "Nguyễn Văn A" → "NGUYEN VAN A". */
export const normalizeText = (value: string): string =>
  value
    .replace(/[đĐ]/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Mã ký gửi (vd "51-926") → mẫu chấp nhận mọi dấu phân tách ("51 926", "51_926",
 * "51926"). Trả null nếu mã quá ngắn, dễ khớp nhầm với số bất kỳ.
 */
export const buildCodePattern = (code: string): RegExp | null => {
  const parts = normalizeText(code)
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const joinedLength = parts.join('').length;
  if (joinedLength < 4) return null;
  if (parts.length < 2 && joinedLength < 6) return null;
  const body = parts.map(escapeRegExp).join('[\\s._/-]?');
  return new RegExp(`(?<![A-Z0-9])${body}(?![A-Z0-9])`);
};

/** Số điện thoại → khớp 9 số cuối, chấp nhận đầu 0 / 84 / +84. */
export const buildPhonePattern = (phone: string): RegExp | null => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9) return null;
  return new RegExp(`(?<![0-9])(?:84|0)?${digits.slice(-9)}(?![0-9])`);
};

/** Số tài khoản ngân hàng (≥ 8 chữ số). */
export const buildAccountPattern = (account: string): RegExp | null => {
  const digits = account.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return new RegExp(`(?<![0-9])${digits}(?![0-9])`);
};

export const classifyTarget = (
  expectedVnd: number,
  allocatedVnd: number
): TargetStatus => {
  if (allocatedVnd <= 0) return 'missing';
  return Math.abs(allocatedVnd - expectedVnd) <= AMOUNT_TOLERANCE_VND
    ? 'matched'
    : 'mismatch';
};

// ─── Ghép ─────────────────────────────────────────────────────────────────────

export const matchTransactions = (input: {
  direction: MatchDirection;
  targets: ExpectedItem[];
  txs: BankTxItem[];
  /** txId → phân bổ đã lưu. Mảng rỗng = đã giải trình, không gán vào khoản nào. */
  manual: Map<string, ManualAllocation[]>;
}): MatchAllocation[] => {
  const { direction, targets, txs, manual } = input;
  const allocations: MatchAllocation[] = [];

  // 1. Quyết định thủ công: luôn giữ nguyên
  const decidedTx = new Set<string>();
  const decidedTarget = new Set<string>();
  manual.forEach((allocs, txId) => {
    decidedTx.add(txId);
    for (const alloc of allocs) {
      decidedTarget.add(alloc.targetId);
      allocations.push({
        txId,
        targetId: alloc.targetId,
        amountVnd: alloc.amountVnd,
        source: 'manual',
      });
    }
  });

  const freeTargets = targets.filter(t => !decidedTarget.has(t.id));
  const freeTxs = txs.filter(x => !decidedTx.has(x.id));

  // Giao dịch nào nhắc tới khoản nào (qua định danh trong nội dung). Tính trên
  // TẤT CẢ khoản, kể cả khoản đã gán thủ công: giao dịch nhắc tới khoản đã chốt
  // thì không được tự ghép nhầm sang khoản khác cùng số tiền.
  const hits = new Map<string, Set<string>>();
  for (const tx of freeTxs) {
    const set = new Set<string>();
    for (const target of targets) {
      if (target.patterns.some(p => p.test(tx.haystack))) set.add(target.id);
    }
    hits.set(tx.id, set);
  }

  // 2. Lượt A: ghép 1-1 theo số tiền + thời gian
  interface Pair {
    target: ExpectedItem;
    tx: BankTxItem;
    score: number;
  }
  const pairs: Pair[] = [];
  for (const target of freeTargets) {
    for (const tx of freeTxs) {
      if (Math.abs(tx.amountVnd - target.expectedVnd) > AMOUNT_TOLERANCE_VND) {
        continue;
      }
      const delta = Math.abs(tx.at.getTime() - target.at.getTime());
      if (delta > WINDOW_MS[direction]) continue;

      // Nội dung đã chỉ rõ một khoản khác → không phải khoản này
      const txHits = hits.get(tx.id) as Set<string>;
      const referencesTarget = txHits.has(target.id);
      if (txHits.size > 0 && !referencesTarget) continue;

      let score = -delta / 60_000; // càng gần về thời gian càng tốt
      if (
        target.nameKey &&
        target.nameKey.length >= 6 &&
        tx.haystack.includes(target.nameKey)
      ) {
        score += 1_000_000;
      }
      if (referencesTarget) score += 10_000_000;
      pairs.push({ target, tx, score });
    }
  }
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      a.target.id.localeCompare(b.target.id) ||
      a.tx.id.localeCompare(b.tx.id)
  );

  const usedTarget = new Set<string>();
  const usedTx = new Set<string>();
  for (const pair of pairs) {
    if (usedTarget.has(pair.target.id) || usedTx.has(pair.tx.id)) continue;
    usedTarget.add(pair.target.id);
    usedTx.add(pair.tx.id);
    allocations.push({
      txId: pair.tx.id,
      targetId: pair.target.id,
      amountVnd: pair.tx.amountVnd,
      source: 'auto',
    });
  }

  // 3. Lượt B: còn định danh nhưng lệch tiền → gán để lộ chênh lệch.
  //    Chỉ khi nội dung nhắc tới đúng MỘT khoản; nhiều khoản thì mơ hồ, bỏ qua.
  const freeTargetById = new Map(freeTargets.map(t => [t.id, t]));
  for (const tx of freeTxs) {
    if (usedTx.has(tx.id)) continue;
    const txHits = hits.get(tx.id) as Set<string>;
    if (txHits.size !== 1) continue;
    const target = freeTargetById.get(Array.from(txHits)[0]);
    if (!target) continue;
    if (
      Math.abs(tx.at.getTime() - target.at.getTime()) > IDENTIFIER_WINDOW_MS
    ) {
      continue;
    }
    allocations.push({
      txId: tx.id,
      targetId: target.id,
      amountVnd: tx.amountVnd,
      source: 'auto',
    });
  }

  return allocations;
};
