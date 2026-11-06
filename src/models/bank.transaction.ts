/**
 * BankTransaction — giao dịch ngân hàng nhận từ SePay (webhook hoặc API v2).
 * Đây là nguồn đối chứng độc lập với dữ liệu nhân viên nhập, nên class này chỉ
 * server (master key) mới được ghi/đọc — xem cloud/finance-guard.
 *
 * Fields:
 *   fingerprint     string          — khoá chống trùng (xem sepay.normalize)
 *   sepayIds        string[]        — các ID SePay đã thấy cho giao dịch này
 *   source          'webhook'|'api' — nguồn nhận đầu tiên
 *   accountNumber   string
 *   bankName        string
 *   type            'in'|'out'
 *   amountVnd       number          — VND, luôn dương
 *   occurredAt      Date            — thời điểm giao dịch (UTC)
 *   content         string          — nội dung chuyển khoản gốc
 *   description     string
 *   referenceCode   string
 *   code            string|null
 *   subAccount      string
 *   accumulatedVnd  number|null
 *   raw             object          — payload gốc, phục vụ truy vết
 *
 * Quyết định đối chiếu thủ công (do người dùng gán, có lưu vết):
 *   allocations     { type, targetId, label, amountVnd }[]
 *   explanation     string          — giải trình cho giao dịch không thuộc đơn/ký gửi nào
 *   linkedById / linkedByName / linkedAt
 *   history         { at, byId, byName, action, detail }[]  — chỉ thêm, không sửa
 */
export class BankTransaction extends Parse.Object {
  constructor() {
    super('BankTransaction');
  }
}

Parse.Object.registerSubclass('BankTransaction', BankTransaction);
