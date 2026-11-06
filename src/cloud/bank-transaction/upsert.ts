import PQueue from 'p-queue';
import { BankTransaction } from '../../models/bank.transaction';
import { NormalizedBankTx } from '../../external-services/sepay/sepay.types';
import { BANK_MARGIN_MS } from '../function/report/reconciliation';
import { invalidateSnapshotsNear } from '../function/report/snapshot';

/**
 * Ghi tuần tự: webhook và lệnh đồng bộ có thể chạy cùng lúc cho cùng một giao dịch.
 * Hàng đợi 1 luồng + kiểm tra tồn tại trước khi tạo chặn trùng trong một tiến trình.
 * (Trùng giữa nhiều tiến trình nếu có vẫn được loại khi đọc, theo fingerprint.)
 */
const queue = new PQueue({ concurrency: 1 });

const CHUNK_SIZE = 100;

const doUpsert = async (
  items: NormalizedBankTx[]
): Promise<{ inserted: number; existing: number }> => {
  let inserted = 0;
  let existing = 0;

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);

    const found = await new Parse.Query(BankTransaction)
      .containedIn(
        'fingerprint',
        chunk.map(item => item.fingerprint)
      )
      .limit(CHUNK_SIZE * 2)
      .find({ useMasterKey: true });
    const byFingerprint = new Map<string, BankTransaction>(
      found.map(obj => [obj.get('fingerprint') as string, obj])
    );

    const toSave: BankTransaction[] = [];
    const seenInChunk = new Set<string>();

    for (const item of chunk) {
      const current = byFingerprint.get(item.fingerprint);
      if (current) {
        existing += 1;
        const ids = (current.get('sepayIds') as string[]) ?? [];
        if (!ids.includes(item.sepayId)) {
          current.set('sepayIds', [...ids, item.sepayId]);
          toSave.push(current);
        }
        continue;
      }
      if (seenInChunk.has(item.fingerprint)) {
        existing += 1;
        continue;
      }
      seenInChunk.add(item.fingerprint);

      const obj = new BankTransaction();
      obj.set({
        fingerprint: item.fingerprint,
        sepayIds: [item.sepayId],
        source: item.source,
        accountNumber: item.accountNumber,
        bankName: item.bankName,
        type: item.type,
        amountVnd: item.amountVnd,
        occurredAt: item.occurredAt,
        content: item.content,
        description: item.description,
        referenceCode: item.referenceCode,
        code: item.code,
        subAccount: item.subAccount,
        accumulatedVnd: item.accumulatedVnd,
        raw: item.raw,
      });
      toSave.push(obj);
      inserted += 1;
    }

    if (toSave.length > 0) {
      // Phải lấy trước khi lưu: sau saveAll thì isNew() không còn đúng nữa.
      const newTimes = new Set(
        toSave
          .filter(obj => obj.isNew())
          .map(obj => (obj.get('occurredAt') as Date).getTime())
      );
      await Parse.Object.saveAll(toSave, { useMasterKey: true });
      // Giao dịch mới làm đổi kết quả đối chiếu của tháng chứa nó (và tháng kề
      // bên nếu sát biên) → bỏ bản lưu báo cáo cũ để lần mở sau tính lại.
      for (const time of newTimes) {
        await invalidateSnapshotsNear(new Date(time), BANK_MARGIN_MS);
      }
    }
  }

  return { inserted, existing };
};

/** Thêm các giao dịch chưa có; giao dịch đã có (cùng fingerprint) chỉ được ghi nhận thêm ID. */
export const upsertBankTransactions = (
  items: NormalizedBankTx[]
): Promise<{ inserted: number; existing: number }> =>
  queue.add(() => doUpsert(items));
