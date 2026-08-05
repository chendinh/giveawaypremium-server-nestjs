/**
 * AppointmentSchedule — Parse Cloud Triggers
 *
 * beforeSave: Validate slot trước khi insert — guard cuối cùng phía server
 * để chặn race condition khi client bị stale (user chưa reload web).
 *
 * Luồng validate:
 * 1. Chỉ áp dụng khi tạo mới (isNew)
 * 2. Lấy Setting hiện tại từ DB
 * 3. Kiểm tra form đặt lịch có đang mở không (IS_SHOW_BOOKING_FORM)
 * 4. Tìm option cho ngày đó (BOOKING_OPTION_EACH_DAY + BOOKING_OPTION_CUSTOM_EACH_DAY)
 * 5. Nếu ngày là OPTION_7 (off) → reject
 * 6. Nếu slot timeCode bị tắt (custom) → reject
 * 7. Kiểm tra slot chưa bị ai chiếm (race condition guard)
 */

const SETTING_OBJECT_ID = 'meu8SzyuLd';

/** Map dayCode (DDMMYYYY) → tên thứ trong tuần (English) */
const getDayNameFromDayCode = (dayCode: string): string => {
  // dayCode = "DDMMYYYY", e.g. "06082026"
  const day = parseInt(dayCode.substring(0, 2), 10);
  const month = parseInt(dayCode.substring(2, 4), 10) - 1;
  const year = parseInt(dayCode.substring(4, 8), 10);
  const date = new Date(year, month, day);
  const days = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  return days[date.getDay()];
};

/**
 * Tìm option number cho một dayCode, dựa trên BOOKING_OPTION_EACH_DAY setting.
 * Default = 8 nếu không tìm thấy.
 */
const findOptionForDay = (
  dayCode: string,
  bookingOptionEachDay: Record<string, string>
): number => {
  for (let i = 1; i <= 9; i++) {
    const key = `OPTION_${i}`;
    const val = bookingOptionEachDay[key];
    if (val && val.includes(dayCode)) return i;
  }
  return 8; // default
};

export const beforeSave = async (
  request: Parse.Cloud.BeforeSaveRequest
): Promise<void> => {
  const object = request.object;

  // Chỉ validate khi tạo mới — update (soft delete, v.v.) không cần check
  if (!object.isNew()) return;

  const slot: string | undefined = object.get('slot');

  if (!slot || slot.length < 12) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      'Thông tin lịch hẹn không hợp lệ.'
    );
  }

  // slot = timeCode (4 chars) + dayCode (8 chars), e.g. "100006082026"
  const timeCode = slot.substring(0, 4);
  const dayCode = slot.substring(4);

  // ── 1. Lấy Setting ──────────────────────────────────────────────────────────
  let settingData: Record<string, any> = {};
  try {
    const settingQuery = new Parse.Query('Setting');
    const settingObj = await settingQuery.get(SETTING_OBJECT_ID, {
      useMasterKey: true,
    });
    settingData = settingObj.get('Setting') || {};
  } catch {
    // Nếu không lấy được setting → vẫn cho qua (fail open để không chặn hết)
    return;
  }

  // ── 2. Check form có đang mở không ──────────────────────────────────────────
  const isShowBookingForm = settingData['IS_SHOW_BOOKING_FORM'];
  if (isShowBookingForm === 'false') {
    throw new Parse.Error(
      142,
      'Tính năng đặt lịch ký gửi hiện đang tạm khoá. Vui lòng gọi hotline 0703 334 443 để được hỗ trợ.'
    );
  }

  // ── 3. Tìm option của ngày này ───────────────────────────────────────────────
  const bookingOptionEachDay: Record<string, string> =
    settingData['BOOKING_OPTION_EACH_DAY'] || {};
  const option = findOptionForDay(dayCode, bookingOptionEachDay);

  // OPTION_7 = nghỉ / off
  if (option === 7) {
    const dayName = getDayNameFromDayCode(dayCode);
    throw new Parse.Error(
      142,
      `Ngày ${dayCode.substring(0, 2)}/${dayCode.substring(2, 4)}/${dayCode.substring(4, 8)} (${dayName}) hiện không nhận lịch hẹn. Vui lòng chọn ngày khác hoặc gọi hotline 0703 334 443.`
    );
  }

  // OPTION_1 = đóng (không có slot nào)
  if (option === 1) {
    throw new Parse.Error(
      142,
      `Khung giờ này hiện đã đóng. Vui lòng chọn ngày khác hoặc gọi hotline 0703 334 443.`
    );
  }

  // ── 4. Check custom slot có bị tắt không ────────────────────────────────────
  const bookingCustomEachDay: Record<string, string> =
    settingData['BOOKING_OPTION_CUSTOM_EACH_DAY'] || {};
  const customForThisDay = bookingCustomEachDay[dayCode];

  // customForThisDay = undefined hoặc 'default' → tất cả slots bật
  // customForThisDay = chuỗi các timeCode được phép → chỉ có trong chuỗi mới được đặt
  if (
    customForThisDay &&
    customForThisDay !== 'default' &&
    !customForThisDay.includes(timeCode)
  ) {
    throw new Parse.Error(
      142,
      `Khung giờ này hiện không còn nhận lịch. Vui lòng chọn khung giờ khác hoặc gọi hotline 0703 334 443.`
    );
  }

  // ── 5. Race condition guard: slot đã bị chiếm chưa ──────────────────────────
  const slotQuery = new Parse.Query('AppointmentSchedule');
  slotQuery.equalTo('slot', slot);
  slotQuery.doesNotExist('deletedAt');
  const existing = await slotQuery.count({ useMasterKey: true });

  if (existing > 0) {
    throw new Parse.Error(
      142,
      'Khung giờ này vừa được khách khác đặt. Trang sẽ cập nhật lại, vui lòng chọn khung giờ khác.'
    );
  }
};
