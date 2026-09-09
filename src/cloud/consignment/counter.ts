/**
 * Atomic ConsignmentId counter — tránh race condition khi 2 request
 * tạo consignment trong cùng group cùng lúc.
 *
 * Vấn đề với approach cũ (count()):
 *   req A: count() → 49  → set "50-926"
 *   req B: count() → 49  → set "50-926"  ← TRÙNG ID
 *
 * Fix: dùng Parse Object với atomic increment.
 * Parse SDK không có findAndModify, nhưng ta có thể dùng
 * Parse.Object.increment() trong transaction-like pattern:
 *   1. Fetch hoặc create Counter document cho group
 *   2. increment('seq') — Parse Server dùng MongoDB $inc internally → atomic
 *   3. Return seq mới
 *
 * Parse.Object.increment() là atomic ở DB level vì Parse Server
 * dịch nó thành MongoDB { $inc: { seq: 1 } } trong cùng 1 write operation.
 *
 * Class: ConsignmentCounter
 *   groupId  (string, indexed, unique) — Parse objectId của ConsignmentGroup
 *   seq      (number) — số thứ tự hiện tại
 */

const COUNTER_CLASS = 'ConsignmentCounter';

/**
 * Lấy số thứ tự tiếp theo cho group, atomic.
 * Nếu counter chưa tồn tại → tạo mới bằng cách đếm consignment hiện có + 1.
 *
 * @returns số thứ tự mới (1-based, duy nhất trong group)
 */
export const getNextConsignmentSeq = async (
  groupId: string,
  groupPointer: Parse.Object
): Promise<number> => {
  // Tìm counter cho group này
  const query = new Parse.Query(COUNTER_CLASS);
  query.equalTo('groupId', groupId);

  let counter = await query.first({ useMasterKey: true });

  if (!counter) {
    // Counter chưa có — khởi tạo từ count thực tế trong DB
    // để không reset về 0 nếu đây là deploy lần đầu với data cũ
    const existingQuery = new Parse.Query('Consignment');
    existingQuery.equalTo('group', groupPointer);
    const existingCount = await existingQuery.count({ useMasterKey: true });

    // Tạo counter mới với seq = existingCount (sẽ increment lên existingCount+1 bên dưới)
    const newCounter = new Parse.Object(COUNTER_CLASS);
    newCounter.set('groupId', groupId);
    newCounter.set('seq', existingCount);

    try {
      counter = await newCounter.save(null, { useMasterKey: true });
    } catch (err: any) {
      // Race condition: counter vừa được tạo bởi request khác cùng lúc
      // → fetch lại
      const refetch = await query.first({ useMasterKey: true });
      if (refetch) {
        counter = refetch;
      } else {
        throw err;
      }
    }
  }

  // Atomic increment: Parse dịch increment() → MongoDB $inc → không bị race
  counter.increment('seq', 1);
  await counter.save(null, { useMasterKey: true });

  return counter.get('seq') as number;
};
