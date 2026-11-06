/**
 * MonthlyReportSnapshot — bản lưu sẵn của báo cáo kiểm kê một THÁNG ĐÃ QUA, để
 * lần sau mở lại không phải tính lại từ hàng nghìn đơn + đối chiếu ngân hàng.
 * Chỉ là cache dẫn xuất (có thể xoá bất cứ lúc nào, báo cáo sẽ tự tính và lưu
 * lại), không phải dữ liệu gốc. Chỉ server (master key) được ghi/đọc — xem
 * cloud/finance-guard.
 *
 * Fields:
 *   month          string  — 'YYYY-MM', duy nhất
 *   schemaVersion  number  — đổi khi cấu trúc báo cáo đổi, bản cũ sẽ bị bỏ qua
 *   payload        string  — JSON.stringify(MonthlyReport) (dạng chuỗi để tránh
 *                            Parse/Mongo từ chối key đặc biệt trong object lồng)
 *   savedByName    string  — người mở báo cáo lần đầu và tạo bản lưu
 */
export class MonthlyReportSnapshot extends Parse.Object {
  constructor() {
    super('MonthlyReportSnapshot');
  }
}

Parse.Object.registerSubclass('MonthlyReportSnapshot', MonthlyReportSnapshot);
