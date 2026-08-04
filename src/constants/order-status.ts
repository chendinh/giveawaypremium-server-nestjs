/**
 * Trạng thái đơn hàng — chuẩn hóa nội bộ
 * Dùng để lưu vào Parse `Transporter.status`
 */
export enum TransporterStatus {
  WAITING_PICK_UP = 'WAITING_PICK_UP', // Chờ lấy hàng
  DELIVERING = 'DELIVERING', // Đang vận chuyển
  DELIVERED = 'DELIVERED', // Giao thành công
  RETURNING_BACK = 'RETURNING_BACK', // Đang hoàn hàng
  RETURNED_BACK = 'RETURNED_BACK', // Hoàn hàng thành công
  FAILED = 'FAILED', // Giao thất bại
  CANCELLED = 'CANCELLED', // Đã hủy
}

// ─── GHTK Status map ─────────────────────────────────────────────────────────
// Ref: https://api.ghtk.vn (status codes từ GHTK)

export const GHTKSTATUS: Record<string, TransporterStatus> = {
  '-1': TransporterStatus.CANCELLED,
  '1': TransporterStatus.WAITING_PICK_UP,
  '2': TransporterStatus.WAITING_PICK_UP,
  '3': TransporterStatus.DELIVERING,
  '4': TransporterStatus.DELIVERING,
  '5': TransporterStatus.DELIVERED,
  '6': TransporterStatus.DELIVERED,
  '7': TransporterStatus.FAILED,
  '8': TransporterStatus.WAITING_PICK_UP,
  '9': TransporterStatus.FAILED,
  '10': TransporterStatus.DELIVERING,
  '11': TransporterStatus.RETURNING_BACK,
  '12': TransporterStatus.WAITING_PICK_UP,
  '13': TransporterStatus.RETURNING_BACK,
  '20': TransporterStatus.RETURNING_BACK,
  '21': TransporterStatus.RETURNED_BACK,
  '45': TransporterStatus.DELIVERED,
  '49': TransporterStatus.FAILED,
  '123': TransporterStatus.DELIVERING,
  '127': TransporterStatus.FAILED,
  '128': TransporterStatus.WAITING_PICK_UP,
  '410': TransporterStatus.DELIVERING,
};

// ─── ViettelPost Status map ───────────────────────────────────────────────────
// Ref: TL Ke-t no-i API TM-T — Mục 8. Luồng chuyển trạng thái đơn hàng

export const VIETTELPOST_STATUS: Record<string, TransporterStatus> = {
  // ── Từ chối / Hủy ──────────────────────────────────────────────────────────
  // 101: ViettelPost từ chối nhận đơn
  '101': TransporterStatus.CANCELLED,
  // 107: Đối tác yêu cầu hủy qua API (TYPE=4 trong UpdateOrder)
  '107': TransporterStatus.CANCELLED,
  // 201: Hủy nhập phiếu gửi
  '201': TransporterStatus.CANCELLED,
  // -100 → -110: Các mã hủy nội bộ VTP
  '-100': TransporterStatus.CANCELLED,
  '-101': TransporterStatus.CANCELLED,
  '-102': TransporterStatus.CANCELLED,
  '-108': TransporterStatus.CANCELLED,
  '-109': TransporterStatus.CANCELLED,
  '-110': TransporterStatus.CANCELLED,

  // ── Chờ lấy hàng ───────────────────────────────────────────────────────────
  // 102: Đơn hàng chờ xử lý
  '102': TransporterStatus.WAITING_PICK_UP,
  // 103: Giao cho bưu cục — bưu cục tiếp nhận
  '103': TransporterStatus.WAITING_PICK_UP,
  // 104: Giao cho bưu tá đi nhận — đã phân công bưu tá
  '104': TransporterStatus.WAITING_PICK_UP,
  // 105: Bưu tá đã nhận hàng thành công (trạng thái cuối nhóm lấy hàng)
  '105': TransporterStatus.WAITING_PICK_UP,

  // ── Đang vận chuyển ────────────────────────────────────────────────────────
  // 200: Nhận từ bưu tá - bưu cục gốc (VTP đã nhập doanh thành công)
  '200': TransporterStatus.DELIVERING,
  // 202: Sửa phiếu gửi
  '202': TransporterStatus.DELIVERING,
  // 300: Khai thác đi — đóng tải
  '300': TransporterStatus.DELIVERING,
  // 301-303, 320: Các bước khai thác trung gian
  '301': TransporterStatus.DELIVERING,
  '302': TransporterStatus.DELIVERING,
  '303': TransporterStatus.DELIVERING,
  '320': TransporterStatus.DELIVERING,
  // 400: Khai thác đến — bàn giao/nhận bàn giao
  '400': TransporterStatus.DELIVERING,
  // 500: Giao bưu tá đi phát — phân công bưu tá đi giao hàng
  '500': TransporterStatus.DELIVERING,
  // 508: Phát tiếp — đơn vị yêu cầu phát tiếp
  '508': TransporterStatus.DELIVERING,
  // 509: Chuyển tiếp bưu cục khác
  '509': TransporterStatus.DELIVERING,

  // ── Giao thành công ────────────────────────────────────────────────────────
  // 501: Phát thành công (trạng thái cuối — không phát sinh thêm trạng thái)
  '501': TransporterStatus.DELIVERED,
  // 502: Chuyển hoàn bưu cục gốc (đã giao, chuẩn bị hoàn tiền)
  '502': TransporterStatus.DELIVERED,

  // ── Đang hoàn hàng ─────────────────────────────────────────────────────────
  // 503: Hủy - theo yêu cầu khách hàng (trạng thái cuối)
  '503': TransporterStatus.RETURNING_BACK,
  // 505: Phát thất bại - yêu cầu chuyển hoàn
  //      Đây là trạng thái quan trọng: đối tác có thể duyệt hoàn (TYPE=2)
  //      hoặc yêu cầu phát tiếp (TYPE=3) qua UpdateOrder
  '505': TransporterStatus.RETURNING_BACK,
  // 506: Phát thất bại - hẹn giao lại (KH nghỉ, không có nhà, không nghe máy)
  '506': TransporterStatus.RETURNING_BACK,
  // 515: Duyệt hoàn — bưu cục phát duyệt hoàn
  '515': TransporterStatus.RETURNING_BACK,

  // ── Hoàn hàng thành công ───────────────────────────────────────────────────
  // 504: Hoàn thành công - chuyển trả người gửi (trạng thái cuối)
  '504': TransporterStatus.RETURNED_BACK,
  // 507: Khách hàng đến bưu cục nhận (trạng thái cuối)
  '507': TransporterStatus.RETURNED_BACK,

  // ── Thất bại ───────────────────────────────────────────────────────────────
  // 550, 551, 570: Các mã thất bại nội bộ VTP
  '550': TransporterStatus.FAILED,
  '551': TransporterStatus.FAILED,
  '570': TransporterStatus.FAILED,
};

/**
 * Các trạng thái CUỐI của ViettelPost — không phát sinh thêm trạng thái sau
 * Ref: Tài liệu VTP mục Webhook
 * Khi nhận webhook với ORDER_STATUS thuộc danh sách này:
 *   - Ghi log và bypass nếu nhận lại (idempotent)
 *   - Không cần poll thêm
 */
export const VTP_FINAL_STATUSES = new Set([
  101, // ViettelPost từ chối nhận
  107, // Đối tác yêu cầu hủy
  201, // Hủy nhập phiếu gửi
  501, // Phát thành công
  503, // Hủy theo yêu cầu KH
  504, // Hoàn thành công
]);

/**
 * Các trạng thái VTP cho phép HỦY đơn (TYPE=4 trong UpdateOrder)
 * Điều kiện: ORDER_STATUS < 200 VÀ khác 105, 107
 */
export const VTP_CANCELLABLE_STATUSES = new Set([102, 103, 104]);

// ─── ORDER_PAYMENT constants ──────────────────────────────────────────────────
// Ref: Tài liệu VTP mục 5. Tạo đơn — trường ORDER_PAYMENT

/** Không thu hộ — đối tác tự trả cước */
export const VTP_PAYMENT_NO_COD = 1;

/** Thu hộ tiền hàng VÀ tiền cước */
export const VTP_PAYMENT_COD_AND_SHIPPING = 2;

/**
 * Thu hộ tiền hàng, KHÔNG thu hộ tiền cước
 * ← Dùng mặc định cho GiveAwayPremium (người mua trả tiền hàng, shop trả cước)
 */
export const VTP_PAYMENT_COD_ONLY = 3;

/** Thu hộ tiền cước, KHÔNG thu hộ tiền hàng */
export const VTP_PAYMENT_SHIPPING_ONLY = 4;

// ─── ORDER_SERVICE phổ biến ───────────────────────────────────────────────────
// Lấy đầy đủ từ API getPriceAll, đây chỉ là các mã thường dùng để tham khảo

/** ViettelPost Chuyển Nhanh — giao trong ngày hoặc 24h */
export const VTP_SERVICE_VCN = 'VCN';

/** ViettelPost Chuyển Phát Nhanh Hỏa Tốc */
export const VTP_SERVICE_VHT = 'VHT';

/** ViettelPost Chuyển Phát Tiết Kiệm */
export const VTP_SERVICE_VCBO = 'VCBO';

/** Phát hàng siêu tốc nội tỉnh */
export const VTP_SERVICE_PHS = 'PHS';

// ─── UPDATE_ORDER TYPE constants ──────────────────────────────────────────────
// Ref: Tài liệu VTP mục 9.1 Cập nhật trạng thái vận đơn

/** Duyệt đơn hàng */
export const VTP_UPDATE_TYPE_APPROVE = 1;

/**
 * Duyệt hoàn
 * Dùng khi đơn có status=505 (thông báo chuyển hoàn) và KH yêu cầu hoàn
 */
export const VTP_UPDATE_TYPE_APPROVE_RETURN = 2;

/**
 * Phát tiếp
 * Dùng khi đơn có status=505 và KH yêu cầu giao lại
 */
export const VTP_UPDATE_TYPE_REDELIVER = 3;

/**
 * Hủy đơn hàng
 * Chỉ dùng khi status < 200 và khác 105, 107
 */
export const VTP_UPDATE_TYPE_CANCEL = 4;

/**
 * Xóa đơn đã hủy
 * Dùng sau khi đơn có status=107
 */
export const VTP_UPDATE_TYPE_DELETE = 11;

// ─── PRODUCT_TYPE ─────────────────────────────────────────────────────────────

/** Hàng hóa thông thường */
export const VTP_PRODUCT_TYPE_GOODS = 'HH';

/** Thư/tài liệu */
export const VTP_PRODUCT_TYPE_LETTER = 'TH';

// ─── NATIONAL_TYPE ────────────────────────────────────────────────────────────

/** Bảng giá quốc tế */
export const VTP_NATIONAL_TYPE_INTERNATIONAL = 0;

/** Bảng giá trong nước */
export const VTP_NATIONAL_TYPE_DOMESTIC = 1;

// ─── OrderRequest status ─────────────────────────────────────────────────────

export enum OrderRequestStatus {
  VALID = 'VALID',
  IN_QUEUE = 'IN_QUEUE',
  CANCELLED = 'CANCELLED',
  IN_ORDER = 'IN_ORDER',
}
