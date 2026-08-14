// ─── ViettelPost API request/response type contracts ───
// Ref: TL Ke-t no-i API TM-T (ViettelPost Partner API docs)

// ─── Auth ───

/** POST /user/Login — đăng nhập lấy short token */
export interface ViettelPostLoginReq {
  USERNAME: string;
  PASSWORD: string;
}

export interface ViettelPostLoginData {
  token: string;
  userId: number;
  partner: number;
  phone: string;
  source: number;
  expired: number;
}

/**
 * POST /user/ownerconnect — đổi short token → long token (1-2 năm)
 * Header: Token = short token từ /user/Login
 * Body: { USERNAME, PASSWORD } — bắt buộc theo tài liệu
 */
export interface ViettelPostOwnerConnectReq {
  USERNAME: string;
  PASSWORD: string;
}

export interface ViettelPostLongTokenData {
  token: string;
  userId: number;
  partner: number;
  phone: string;
  source: number;
  expired: number;
}

/**
 * POST /user/LoginVTP — lấy token bằng secret key từ website viettelpost.vn
 * Dùng khi đã lấy token thủ công trên https://viettelpost.vn/cau-hinh-tai-khoan
 */
export interface ViettelPostLoginVTPReq {
  token: string; // secret key lấy từ website, không phải JWT token
}

// ─── Địa danh ───

/** GET /categories/listProvinceById?provinceId=-1 */
export interface ViettelPostProvince {
  PROVINCE_ID: number;
  PROVINCE_CODE: string;
  PROVINCE_NAME: string;
}

/** GET /categories/listDistrict?provinceId=... */
export interface ViettelPostDistrict {
  DISTRICT_ID: number;
  DISTRICT_VALUE: string;
  DISTRICT_NAME: string;
  PROVINCE_ID: number;
}

/** GET /categories/listWards?districtId=... */
export interface ViettelPostWard {
  WARDS_ID: number;
  WARDS_NAME: string;
  DISTRICT_ID: number;
}

// ─── Dịch vụ & Tính cước ───

/**
 * POST /order/getPriceAll — lấy danh sách dịch vụ theo địa chỉ ID
 * Lưu ý: SENDER_WARD và RECEIVER_WARD là bắt buộc
 */
export interface ViettelPostGetServicesReq {
  SENDER_PROVINCE: number;
  SENDER_DISTRICT: number;
  SENDER_WARD: number; // bắt buộc
  RECEIVER_PROVINCE: number;
  RECEIVER_DISTRICT: number;
  RECEIVER_WARD: number; // bắt buộc
  PRODUCT_TYPE: 'HH' | 'TH'; // HH: hàng hóa, TH: thư
  PRODUCT_WEIGHT: number; // gram
  PRODUCT_PRICE: number; // VNĐ
  MONEY_COLLECTION: number; // tiền COD
  TYPE: 1 | 0; // 1: trong nước, 0: quốc tế
  PRODUCT_LENGTH?: number; // cm
  PRODUCT_WIDTH?: number; // cm
  PRODUCT_HEIGHT?: number; // cm
}

export interface ViettelPostExtraService {
  SERVICE_CODE: string;
  SERVICE_NAME: string;
  DESCRIPTION: string | null;
}

export interface ViettelPostServiceItem {
  MA_DV_CHINH: string; // mã dịch vụ → dùng cho ORDER_SERVICE
  TEN_DICHVU: string;
  GIA_CUOC: number; // tổng cước đã VAT
  THOI_GIAN: string;
  EXCHANGE_WEIGHT: number;
  EXTRA_SERVICE: ViettelPostExtraService[];
}

/**
 * POST /order/getPrice — tính cước theo địa chỉ ID + dịch vụ cụ thể
 * Lưu ý: Khác getPriceAll — trả về chi tiết cước 1 dịch vụ
 */
export interface ViettelPostPriceEstimateReq {
  PRODUCT_WEIGHT: number;
  PRODUCT_PRICE: number;
  MONEY_COLLECTION: number;
  ORDER_SERVICE_ADD: string;
  ORDER_SERVICE: string;
  SENDER_PROVINCE: number;
  SENDER_DISTRICT: number;
  SENDER_WARD: number; // bắt buộc — đã fix (trước đây thiếu)
  RECEIVER_PROVINCE: number;
  RECEIVER_DISTRICT: number;
  RECEIVER_WARD: number; // bắt buộc — đã fix (trước đây thiếu)
  PRODUCT_TYPE: 'HH' | 'TH';
  NATIONAL_TYPE: 1 | 0;
  PRODUCT_LENGTH?: number;
  PRODUCT_WIDTH?: number;
  PRODUCT_HEIGHT?: number;
}

export interface ViettelPostPriceEstimateData {
  MONEY_TOTAL_OLD: number;
  MONEY_TOTAL: number;
  MONEY_TOTAL_FEE: number;
  MONEY_FEE: number;
  MONEY_COLLECTION_FEE: number;
  MONEY_OTHER_FEE: number;
  MONEY_VAS: number;
  MONEY_VAT: number;
  KPI_HT: number;
}

// ─── Tạo đơn / Cập nhật đơn ───

export interface ViettelPostOrderItem {
  PRODUCT_NAME: string;
  PRODUCT_WEIGHT: number;
  PRODUCT_QUANTITY: number;
  PRODUCT_PRICE: number;
}

/**
 * POST /order/createOrder — tạo đơn bằng địa chỉ ID
 * POST /order/createOrderNlp — tạo đơn bằng địa chỉ text
 */
export interface ViettelPostCreateOrderReq {
  ORDER_NUMBER?: string; // mã nội bộ của partner (optional)
  SENDER_FULLNAME: string;
  SENDER_ADDRESS: string;
  SENDER_PHONE: string;
  SENDER_PROVINCE?: number; // chỉ dùng với createOrder (địa chỉ ID)
  SENDER_DISTRICT?: number;
  SENDER_WARD?: number;
  RECEIVER_FULLNAME: string;
  RECEIVER_ADDRESS: string;
  RECEIVER_PHONE: string;
  RECEIVER_PROVINCE?: number; // chỉ dùng với createOrder (địa chỉ ID)
  RECEIVER_DISTRICT?: number;
  RECEIVER_WARD?: number;
  PRODUCT_NAME?: string;
  PRODUCT_QUANTITY?: number;
  PRODUCT_PRICE?: number;
  PRODUCT_WEIGHT?: number;
  PRODUCT_LENGTH?: number;
  PRODUCT_WIDTH?: number;
  PRODUCT_HEIGHT?: number;
  PRODUCT_TYPE?: 'HH' | 'TH';
  /**
   * Loại vận đơn:
   * 1 = Không thu hộ
   * 2 = Thu hộ tiền hàng và tiền cước
   * 3 = Thu hộ tiền hàng, KHÔNG thu hộ tiền cước  ← mặc định dùng
   * 4 = Thu hộ tiền cước, không thu hộ tiền hàng
   */
  ORDER_PAYMENT: 1 | 2 | 3 | 4;
  /**
   * Loại gửi hàng:
   * 1 = Gửi hàng thường (shipper đến lấy tại kho)
   * 2 = Hoàn hàng
   */
  ORDER_TYPE?: 1 | 2;
  ORDER_SERVICE: string; // lấy từ MA_DV_CHINH của getPriceAll
  ORDER_SERVICE_ADD?: string; // mã dịch vụ cộng thêm, cách nhau bởi dấu phẩy
  ORDER_NOTE?: string; // tối đa 150 bytes
  MONEY_COLLECTION?: number; // tiền COD
  EXTRA_MONEY?: number; // tiền xem hàng không lấy (dịch vụ XMG)
  CHECK_UNIQUE?: boolean;
  ENABLE_SORT_CODE?: boolean;
  LIST_ITEM?: Partial<ViettelPostOrderItem>[];
  GROUPADDRESS_ID?: number;
  [key: string]: unknown;
}

export interface ViettelPostCreateOrderData {
  ORDER_NUMBER: string;
  MONEY_COLLECTION: number;
  EXCHANGE_WEIGHT: number;
  MONEY_TOTAL: number;
  MONEY_TOTAL_FEE: number;
  MONEY_FEE: number;
  MONEY_COLLECTION_FEE: number;
  MONEY_OTHER_FEE: number;
  MONEY_VAS: number;
  MONEY_VAT: number;
  KPI_HT: number;
  RECEIVER_PROVINCE: number;
  RECEIVER_DISTRICT: number;
  RECEIVER_WARD: number;
}

/**
 * POST /order/UpdateOrder — cập nhật trạng thái đơn
 * TYPE:
 *  1 = Duyệt đơn hàng
 *  2 = Duyệt hoàn (khi đơn status=505)
 *  3 = Phát tiếp (khi đơn status=505)
 *  4 = Hủy đơn (chỉ khi status < 200, khác 105 và 107)
 * 11 = Xóa đơn đã hủy (sau khi đơn status=107)
 */
export interface ViettelPostUpdateOrderReq {
  TYPE: 1 | 2 | 3 | 4 | 11;
  ORDER_NUMBER: string;
  NOTE?: string; // tối đa 150 ký tự
}

// ─── Webhook payload từ ViettelPost ───

export interface ViettelPostWebhookPOD {
  IMAGES: string[];
}

export interface ViettelPostWebhookData {
  ORDER_NUMBER: string;
  ORDER_REFERENCE: string; // mã đơn của partner
  ORDER_STATUSDATE: string; // "dd/MM/yyyy HH:mm:ss"
  ORDER_STATUS: number; // mã trạng thái VTP
  STATUS_NAME: string;
  LOCALION_CURRENTLY: string;
  LOCATION_CURRENTLY: string;
  NOTE: string;
  MONEY_COLLECTION: number;
  MONEY_FEECOD: number;
  MONEY_TOTALFEE: number;
  MONEY_TOTAL: number;
  MONEY_TOTALVAT: number;
  EXPECTED_DELIVERY: string;
  PRODUCT_WEIGHT: number;
  ORDER_SERVICE: string;
  ORDER_SERVICE_ADD: string | null;
  ORDER_PAYMENT: number;
  EXPECTED_DELIVERY_DATE: string | null;
  DETAIL: unknown[];
  VOUCHER_VALUE: number;
  MONEY_COLLECTION_ORIGIN: number | null; // null trước TT200
  EMPLOYEE_NAME: string;
  EMPLOYEE_PHONE: string;
  IS_RETURNING: boolean;
  POD: ViettelPostWebhookPOD;
  REASON_CODE: string | null;
  RECEIVER_FULLNAME: string;
  ORDER_NOTE?: string;
  GROUPADDRESS_ID?: string;
}

export interface ViettelPostWebhookPayload {
  DATA: ViettelPostWebhookData;
  TOKEN: string; // secret key của partner để xác thực nguồn gốc
}

// ─── In vận đơn ───

/**
 * POST /order/printing-code — lấy mã code để tạo link in
 * (thay thế encryptLinkPrint cũ)
 */
export interface ViettelPostPrintingCodeReq {
  ORDER_ARRAY: string[]; // tối đa 100 vận đơn
  EXPIRY_TIME: number; // epoch milliseconds (thời điểm tương lai)
}

/**
 * Link in vận đơn sau khi có code từ printing-code:
 * Production A5: https://digitalize.viettelpost.vn/DigitalizePrint/report.do?type=1&bill={code}&showPostage=1
 * Production A6: https://digitalize.viettelpost.vn/DigitalizePrint/report.do?type=2&bill={code}&showPostage=1
 * Dev A5:        https://dev-print.viettelpost.vn/DigitalizePrint/report.do?type=1&bill={code}&showPostage=1
 */

// ─── Generic response envelope ───

export interface ViettelPostApiResponse<T = unknown> {
  status: number;
  error: boolean;
  message: string;
  data: T;
}

// ─── Normalized results ───

export interface ViettelPostLoginResult {
  token: string;
  userId?: number;
  partner?: number;
  phone?: string;
  source?: number;
  expired?: number;
}

export interface ViettelPostCreateOrderResult {
  req: unknown;
  body: Partial<ViettelPostCreateOrderReq>;
  res: ViettelPostApiResponse<ViettelPostCreateOrderData>;
  success: boolean;
}
