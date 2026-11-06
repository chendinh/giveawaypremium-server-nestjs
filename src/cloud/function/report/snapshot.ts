import PQueue from 'p-queue';

import { currentVnMonth, monthOfDate } from '../../../common/vn-time';
import { MonthlyReportSnapshot } from '../../../models/monthly.report.snapshot';
import logger from '../../../plugins/logger';
import { MonthlyReport } from './types';

/**
 * Bản lưu sẵn báo cáo tháng đã qua (bảng MonthlyReportSnapshot).
 *
 * Quy tắc:
 *  - Chỉ lưu THÁNG ĐÃ QUA (< tháng hiện tại, giờ VN). Tháng hiện tại còn phát
 *    sinh đơn/giao dịch liên tục nên luôn tính trực tiếp.
 *  - Bản lưu là cache, không phải dữ liệu gốc: xoá đi thì lần mở sau tự tính và
 *    lưu lại. Số liệu "đóng băng" tại thời điểm lưu (savedAt); muốn cập nhật
 *    (ví dụ vừa bấm trả tiền khách muộn) thì tải lại có `refresh`.
 *  - Phải tăng SNAPSHOT_SCHEMA_VERSION mỗi khi đổi cấu trúc MonthlyReport, để
 *    bản lưu cũ không bị trả về thiếu field mới.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Ghi tuần tự để hai người mở cùng một tháng cùng lúc không tạo trùng bản lưu. */
const writeQueue = new PQueue({ concurrency: 1 });

export const isPastMonth = (month: string): boolean => month < currentVnMonth();

export interface StoredSnapshot {
  report: MonthlyReport;
  savedAt: Date;
}

export const loadSnapshot = async (
  month: string
): Promise<StoredSnapshot | null> => {
  const row = await new Parse.Query(MonthlyReportSnapshot)
    .equalTo('month', month)
    .equalTo('schemaVersion', SNAPSHOT_SCHEMA_VERSION)
    .descending('updatedAt')
    .first({ useMasterKey: true });
  if (!row) return null;

  try {
    const report = JSON.parse(String(row.get('payload'))) as MonthlyReport;
    return { report, savedAt: row.updatedAt };
  } catch (err) {
    // Bản lưu hỏng không được làm hỏng báo cáo: bỏ qua, caller sẽ tính lại và ghi đè.
    logger.warn(
      `[Snapshot] Bản lưu tháng ${month} không đọc được, sẽ tính lại: ${(err as Error).message}`
    );
    return null;
  }
};

export const saveSnapshot = (
  month: string,
  report: MonthlyReport,
  savedByName: string
): Promise<void> =>
  writeQueue.add(async () => {
    try {
      const existing = await new Parse.Query(MonthlyReportSnapshot)
        .equalTo('month', month)
        .descending('updatedAt')
        .first({ useMasterKey: true });
      const row = existing ?? new MonthlyReportSnapshot();
      await row.save(
        {
          month,
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          payload: JSON.stringify(report),
          savedByName,
        },
        { useMasterKey: true }
      );
    } catch (err) {
      // Lưu cache thất bại không được làm báo cáo vừa tính xong bị lỗi theo.
      logger.error(
        `[Snapshot] Không lưu được bản lưu tháng ${month}: ${(err as Error).message}`
      );
    }
  });

/**
 * Xoá bản lưu của mọi tháng mà một thời điểm có thể ảnh hưởng tới. Đối chiếu
 * ngân hàng ghép giao dịch trong cửa sổ đệm hai đầu tháng (`marginMs`), nên một
 * giao dịch sát biên tháng làm đổi cả tháng bên cạnh.
 */
export const invalidateSnapshotsNear = async (
  at: Date,
  marginMs: number
): Promise<void> => {
  const months = new Set([
    monthOfDate(new Date(at.getTime() - marginMs)),
    monthOfDate(at),
    monthOfDate(new Date(at.getTime() + marginMs)),
  ]);
  await Promise.all(Array.from(months).map(invalidateSnapshot));
};

/**
 * Xoá bản lưu của một tháng — gọi khi dữ liệu đầu vào của báo cáo đổi mà bản lưu
 * không tự biết (gán/huỷ gán giao dịch ngân hàng, đồng bộ SePay). Lần mở sau sẽ
 * tự tính và lưu lại.
 */
export const invalidateSnapshot = async (month: string): Promise<void> => {
  try {
    const rows = await new Parse.Query(MonthlyReportSnapshot)
      .equalTo('month', month)
      .find({ useMasterKey: true });
    if (rows.length > 0) {
      await Parse.Object.destroyAll(rows, { useMasterKey: true });
    }
  } catch (err) {
    logger.error(
      `[Snapshot] Không xoá được bản lưu tháng ${month}: ${(err as Error).message}`
    );
  }
};
