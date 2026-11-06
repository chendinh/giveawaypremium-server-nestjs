/**
 * Tiện ích thời gian theo múi giờ Việt Nam (UTC+7, không có giờ mùa hè).
 *
 * Báo cáo theo tháng phải cắt theo giờ VN, không phụ thuộc múi giờ của server
 * (DigitalOcean/Vercel chạy UTC) hay của trình duyệt người xem.
 */

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Tháng báo cáo dạng 'YYYY-MM'. */
export const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

const pad = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM' → [đầu tháng, đầu tháng sau) theo giờ VN. `to` là mốc loại trừ. */
export const getMonthRange = (month: string): { from: Date; to: Date } => {
  if (!MONTH_REGEX.test(month)) {
    throw new Error(`Tháng không hợp lệ: ${month}`);
  }
  const [year, mon] = month.split('-').map(Number);
  return {
    from: new Date(Date.UTC(year, mon - 1, 1) - VN_OFFSET_MS),
    // Date.UTC tự cuốn tháng 12 sang tháng 1 năm sau
    to: new Date(Date.UTC(year, mon, 1) - VN_OFFSET_MS),
  };
};

/** Tháng 'YYYY-MM' chứa một thời điểm, theo giờ VN. */
export const monthOfDate = (date: Date): string => {
  const v = new Date(date.getTime() + VN_OFFSET_MS);
  return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}`;
};

/** Tháng hiện tại 'YYYY-MM' theo giờ VN. */
export const currentVnMonth = (): string => monthOfDate(new Date());

const toDate = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): Date | null => {
  const date = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - VN_OFFSET_MS
  );
  return Number.isNaN(date.getTime()) ? null : date;
};

/** 'YYYY-MM-DD HH:mm[:ss]' (giờ VN, định dạng SePay) → Date. */
export const parseVnDateTime = (
  text: string | null | undefined
): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    String(text ?? '').trim()
  );
  if (!m) return null;
  return toDate(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0));
};

/** 'dd-MM-yyyy[ HH:mm]' (định dạng timeConfirmGetMoney, giờ VN) → Date. */
export const parseDayMonthYear = (
  text: string | null | undefined
): Date | null => {
  const m = /^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(
    String(text ?? '').trim()
  );
  if (!m) return null;
  return toDate(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), 0);
};

/** Date → 'YYYY-MM-DD HH:mm:ss' theo giờ VN (định dạng tham số SePay API). */
export const formatVnDateTime = (date: Date): string => {
  const v = new Date(date.getTime() + VN_OFFSET_MS);
  return (
    `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ` +
    `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`
  );
};
