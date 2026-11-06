/**
 * ReportAttachment — ảnh bill chuyển tiền / sao kê ngân hàng do quản lý tải lên
 * đính kèm báo cáo tháng. Chỉ server (master key) được ghi/đọc — xem
 * cloud/finance-guard. Không bao giờ xoá thật: xoá = đặt deletedAt + lý do.
 *
 * Fields:
 *   month            string          — 'YYYY-MM'
 *   kind             'payout_bill'|'bank_statement'|'other'
 *   media            Pointer<Media>
 *   url              string          — secure_url, sao chép từ Media lúc đính kèm
 *   note             string
 *   uploadedById / uploadedByName
 *   deletedAt / deletedById / deletedByName / deleteReason
 */
export class ReportAttachment extends Parse.Object {
  constructor() {
    super('ReportAttachment');
  }
}

Parse.Object.registerSubclass('ReportAttachment', ReportAttachment);
