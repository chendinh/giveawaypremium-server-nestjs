/**
 * ViettelPost Partner API integration
 * Ref: TL Ke-t no-i API TM-T (ViettelPost Partner API docs)
 * Base URL: https://partner.viettelpost.vn/v2
 *
 * Luồng xác thực (chọn 1 trong 2):
 *
 * Cách A — Username/Password:
 *   1. login(username, password)      → POST /user/Login       → short token
 *   2. getLongToken(shortToken)       → POST /user/ownerconnect → long token (1-2 năm)
 *   3. Dùng long token cho mọi API call
 *
 * Cách B — Secret key từ website (khuyến nghị):
 *   1. Lấy secret key thủ công tại https://viettelpost.vn/cau-hinh-tai-khoan
 *   2. loginBySecretKey(secretKey)    → POST /user/LoginVTP     → long token trực tiếp
 *   3. Dùng long token cho mọi API call
 */

import logger from '../../plugins/logger';
import {
  OrderReq,
  PriceEstimateReq,
  Transporter,
  TransporterOption,
  CreateOrderResult,
  LoginResult,
  LongTokenResult,
  OrderLabelOptions,
} from './interface';
import {
  ViettelPostApiResponse,
  ViettelPostLoginReq,
  ViettelPostLoginData,
  ViettelPostOwnerConnectReq,
  ViettelPostLongTokenData,
  ViettelPostLoginVTPReq,
  ViettelPostPriceEstimateReq,
  ViettelPostPriceEstimateData,
  ViettelPostGetServicesReq,
  ViettelPostServiceItem,
  ViettelPostCreateOrderReq,
  ViettelPostCreateOrderData,
  ViettelPostUpdateOrderReq,
  ViettelPostOrderItem,
  ViettelPostPrintingCodeReq,
  ViettelPostLoginResult,
} from './viettelpost.types';
import fetch, { Response } from 'node-fetch';
import { viettelpostConfigs } from '../../config/viettelpost.config';
import { pickBy, identity } from 'lodash';

const {
  viettelpostToken,
  viettelpostUrl,
  viettelpostUsername,
  viettelpostPassword,
} = viettelpostConfigs;

// Module-level cache — được set một lần khi server khởi động
// hoặc khi gọi login/getLongToken/loginBySecretKey
let cachedToken: string = viettelpostToken;

// URL in vận đơn (production)
const PRINT_BASE_URL =
  'https://digitalize.viettelpost.vn/DigitalizePrint/report.do';
const PRINT_BASE_URL_DEV =
  'https://dev-print.viettelpost.vn/DigitalizePrint/report.do';

export class ViettelPost implements Transporter {
  constructor(_options: TransporterOption) {}

  // ─── Token ───────────────────────────────────────────────────────────────

  private getToken(): string {
    if (!cachedToken) {
      throw new Error(
        'ViettelPost token chưa được cấu hình. ' +
          'Cần gọi login() + getLongToken() hoặc loginBySecretKey() trước, ' +
          'hoặc set VIETTELPOST_TOKEN trong .env'
      );
    }
    return cachedToken;
  }

  // ─── Response handler ────────────────────────────────────────────────────

  private async handleFetchResponse<T = unknown>(
    response: Response
  ): Promise<ViettelPostApiResponse<T>> {
    if (response.status === 500) {
      throw new Error(`ViettelPost server error: ${response.statusText}`);
    }
    const json = (await response.json()) as ViettelPostApiResponse<T>;
    if (response.status !== 200 || json.status !== 200) {
      logger.error('[ViettelPost] API error response:', json);
      throw new Error(json.message || 'ViettelPost request failed');
    }
    return json;
  }

  private handleError(functionName: string, error: Error): never {
    logger.error(`[ViettelPost] ${functionName} error:`, error.message);
    throw error;
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  /**
   * Bước 1 (Cách A): Đăng nhập lấy short token
   * POST /user/Login
   */
  public async login(
    username?: string,
    password?: string
  ): Promise<LoginResult> {
    try {
      const user = username || viettelpostUsername;
      const pass = password || viettelpostPassword;

      if (!user || !pass) {
        throw new Error(
          'ViettelPost: cần USERNAME và PASSWORD để login. ' +
            'Set VIETTELPOST_USERNAME và VIETTELPOST_PASSWORD trong .env'
        );
      }

      const body: ViettelPostLoginReq = { USERNAME: user, PASSWORD: pass };

      const response = await fetch(`${viettelpostUrl}/user/Login`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      const json =
        await this.handleFetchResponse<ViettelPostLoginData>(response);
      const token = json.data?.token ?? '';

      if (token) cachedToken = token;

      return {
        token,
        userId: json.data?.userId,
        source: json.data?.source,
        expired: String(json.data?.expired ?? ''),
      };
    } catch (error) {
      return this.handleError('login', error as Error);
    }
  }

  /**
   * Bước 2 (Cách A): Đổi short token → long token (1-2 năm)
   * POST /user/ownerconnect
   *
   * QUAN TRỌNG: Theo tài liệu, body BẮT BUỘC phải có USERNAME + PASSWORD
   * (code cũ bị thiếu body này)
   */
  public async getLongToken(shortToken?: string): Promise<LongTokenResult> {
    try {
      const token = shortToken || this.getToken();
      const user = viettelpostUsername;
      const pass = viettelpostPassword;

      if (!user || !pass) {
        throw new Error(
          'ViettelPost: cần USERNAME và PASSWORD cho ownerconnect. ' +
            'Set VIETTELPOST_USERNAME và VIETTELPOST_PASSWORD trong .env'
        );
      }

      const body: ViettelPostOwnerConnectReq = {
        USERNAME: user,
        PASSWORD: pass,
      };

      const response = await fetch(`${viettelpostUrl}/user/ownerconnect`, {
        method: 'POST',
        body: JSON.stringify(body), // ← FIX: code cũ thiếu body này
        headers: {
          'Content-Type': 'application/json',
          Token: token,
        },
      });

      const json =
        await this.handleFetchResponse<ViettelPostLongTokenData>(response);
      const longToken = json.data?.token ?? '';

      if (longToken) cachedToken = longToken;

      return {
        token: longToken,
        expired: String(json.data?.expired ?? ''),
      };
    } catch (error) {
      return this.handleError('getLongToken', error as Error);
    }
  }

  /**
   * Cách B (khuyến nghị): Lấy token bằng secret key từ website
   * POST /user/LoginVTP
   *
   * Lấy secret key tại: https://viettelpost.vn/cau-hinh-tai-khoan
   * → Thêm mới token → copy token → dùng ở đây
   */
  public async loginBySecretKey(
    secretKey: string
  ): Promise<ViettelPostLoginResult> {
    try {
      if (!secretKey) {
        throw new Error('ViettelPost: secretKey không được để trống');
      }

      const body: ViettelPostLoginVTPReq = { token: secretKey };

      const response = await fetch(`${viettelpostUrl}/user/LoginVTP`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      const json =
        await this.handleFetchResponse<ViettelPostLoginData>(response);
      const longToken = json.data?.token ?? '';

      if (longToken) cachedToken = longToken;

      return {
        token: longToken,
        userId: json.data?.userId,
        partner: json.data?.partner,
        phone: json.data?.phone,
        source: json.data?.source,
        expired: json.data?.expired,
      };
    } catch (error) {
      return this.handleError('loginBySecretKey', error as Error);
    }
  }

  // ─── Địa danh ─────────────────────────────────────────────────────────────

  /**
   * Lấy danh sách dịch vụ vận chuyển theo địa chỉ ID
   * POST /order/getPriceAll
   * Dùng để lấy MA_DV_CHINH cho ORDER_SERVICE khi tạo đơn
   */
  public async getServices(
    req: ViettelPostGetServicesReq
  ): Promise<ViettelPostServiceItem[]> {
    try {
      const response = await fetch(`${viettelpostUrl}/order/getPriceAll`, {
        method: 'POST',
        body: JSON.stringify(req),
        headers: {
          'Content-Type': 'application/json',
          Token: this.getToken(),
        },
      });

      if (!response.ok) {
        throw new Error(`getPriceAll HTTP ${response.status}`);
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new Error(
          'Không có dịch vụ vận chuyển cho tuyến này (invalid response)'
        );
      }

      // getPriceAll trả về array trực tiếp, không có envelope {status, data}
      if (Array.isArray(json)) return json as ViettelPostServiceItem[];

      // Nếu có envelope thì lấy data
      const jsonObj = json as Record<string, unknown>;
      if (jsonObj?.data && Array.isArray(jsonObj.data))
        return jsonObj.data as ViettelPostServiceItem[];

      // Nếu API trả về lỗi có message
      if (jsonObj?.message) {
        throw new Error(String(jsonObj.message));
      }

      return [];
    } catch (error) {
      return this.handleError('getServices', error as Error);
    }
  }

  // ─── Tính cước ────────────────────────────────────────────────────────────

  /**
   * Tính cước — dùng getPriceAll để tự chọn service tốt nhất cho tuyến đó
   * POST /order/getPriceAll → lấy danh sách service → chọn VCN/LCOD/VHT/service đầu tiên
   */
  public async getPriceEstimate(req: PriceEstimateReq): Promise<number> {
    try {
      const { from, to, weight, value, serviceLevel } = req;

      // Lấy danh sách tất cả service khả dụng cho tuyến này
      const services = await this.getServices({
        SENDER_PROVINCE: Number(from.province),
        SENDER_DISTRICT: Number(from.district),
        SENDER_WARD: Number(from.ward),
        RECEIVER_PROVINCE: Number(to.province),
        RECEIVER_DISTRICT: Number(to.district),
        RECEIVER_WARD: Number(to.ward),
        PRODUCT_TYPE: 'HH',
        PRODUCT_WEIGHT: weight,
        PRODUCT_PRICE: value ?? 0,
        MONEY_COLLECTION: 0,
        TYPE: 1,
      });

      if (!services || services.length === 0) {
        throw new Error('Không có dịch vụ vận chuyển cho tuyến này');
      }

      // Ưu tiên: serviceLevel request → VCN → LCOD → VHT → service đầu tiên
      const preferred = ['VCN', 'LCOD', 'VHT'];
      const priority = serviceLevel ? [serviceLevel, ...preferred] : preferred;
      let chosen = services.find(s => priority.includes(s.MA_DV_CHINH));
      if (!chosen) chosen = services[0]; // fallback: service đầu tiên

      logger.info(
        `[VTP getPriceEstimate] Tuyến ${from.district}→${to.district}: ` +
          `chọn ${chosen.MA_DV_CHINH} (${chosen.TEN_DICHVU}) = ${chosen.GIA_CUOC} VNĐ`
      );

      return chosen.GIA_CUOC ?? 0;
    } catch (error) {
      return this.handleError('getPriceEstimate', error as Error);
    }
  }

  // ─── Tạo đơn ──────────────────────────────────────────────────────────────

  /**
   * Tạo đơn hàng
   * POST /order/createOrder (địa chỉ ID — dùng PROVINCE/DISTRICT/WARD)
   */
  public async createOrder(req: OrderReq): Promise<CreateOrderResult> {
    try {
      const { from, to, value, serviceLevel, note, orderRequest, items } = req;

      const productName = items.map(item => item.name).join(', ');
      const productWeight = items.reduce(
        (sum, item) => sum + item.weight * item.quantity,
        0
      );
      const productQty = items.reduce((sum, item) => sum + item.quantity, 0);

      // Tự chọn service tốt nhất cho tuyến — tránh lỗi "Price does not apply"
      const services = await this.getServices({
        SENDER_PROVINCE: Number(from.province),
        SENDER_DISTRICT: Number(from.district),
        SENDER_WARD: Number(from.ward),
        RECEIVER_PROVINCE: Number(to.province),
        RECEIVER_DISTRICT: Number(to.district),
        RECEIVER_WARD: Number(to.ward),
        PRODUCT_TYPE: 'HH',
        PRODUCT_WEIGHT: productWeight || 500,
        PRODUCT_PRICE: value ?? 0,
        MONEY_COLLECTION: req.codMoney ?? 0,
        TYPE: 1,
      });

      // Bỏ qua serviceLevel không hợp lệ (SHT, HT, ht, v.v.) — chỉ dùng mã VTP chuẩn
      const VALID_VTP_SERVICES = new Set(services.map(s => s.MA_DV_CHINH));
      const resolvedServiceLevel =
        serviceLevel && VALID_VTP_SERVICES.has(serviceLevel.toUpperCase())
          ? serviceLevel.toUpperCase()
          : undefined;

      const preferred = ['VCN', 'LCOD', 'VHT', 'NCOD', 'SCOD'];
      const priority = resolvedServiceLevel
        ? [resolvedServiceLevel, ...preferred]
        : preferred;
      let chosenService = services.find(s => priority.includes(s.MA_DV_CHINH));
      if (!chosenService && services.length > 0) chosenService = services[0];

      if (!chosenService) {
        throw new Error(
          `Không có dịch vụ VTP cho tuyến ${from.district}→${to.district}. ` +
            'Kiểm tra lại địa chỉ người nhận (province/district/ward ID).'
        );
      }

      logger.info(
        `[VTP createOrder] Available services: ${services.map(s => s.MA_DV_CHINH).join(', ')}`
      );

      const resolvedService = chosenService.MA_DV_CHINH;
      logger.info(
        `[VTP createOrder] Tuyến ${from.district}→${to.district}: service=${resolvedService} (${chosenService?.TEN_DICHVU || 'fallback'})`
      );

      let order: ViettelPostCreateOrderReq = {
        SENDER_FULLNAME: from.name,
        SENDER_ADDRESS: from.address,
        SENDER_PHONE: from.phone,
        SENDER_PROVINCE: Number(from.province),
        SENDER_DISTRICT: Number(from.district),
        SENDER_WARD: Number(from.ward),
        RECEIVER_FULLNAME: to.name,
        RECEIVER_ADDRESS: to.address,
        RECEIVER_PHONE: to.phone,
        RECEIVER_PROVINCE: Number(to.province),
        RECEIVER_DISTRICT: Number(to.district),
        RECEIVER_WARD: Number(to.ward),
        PRODUCT_NAME: productName,
        PRODUCT_QUANTITY: productQty,
        PRODUCT_PRICE: value,
        PRODUCT_WEIGHT: productWeight,
        PRODUCT_TYPE: 'HH',
        /**
         * ORDER_PAYMENT = 4: Thu hộ tiền cước, không thu hộ tiền hàng
         * Phù hợp với model GiveAwayPremium: tiền hàng đã CK trước, khách trả cước khi nhận
         */
        ORDER_PAYMENT: 4,
        ORDER_SERVICE: resolvedService,
        ORDER_NOTE: note || '',
        MONEY_COLLECTION: req.codMoney ?? 0,
        CHECK_UNIQUE: true,
        ENABLE_SORT_CODE: true,
        LIST_ITEM: items.map(item =>
          pickBy<Partial<ViettelPostOrderItem>>(
            {
              PRODUCT_NAME: item.name,
              PRODUCT_WEIGHT: item.weight,
              PRODUCT_QUANTITY: item.quantity,
              PRODUCT_PRICE: 0,
            },
            identity
          )
        ),
      };

      // Cho phép override bất kỳ field nào từ caller,
      // nhưng KHÔNG cho phép override ORDER_SERVICE (đã được chọn tự động)
      // và loại ORDER_TYPE (không hợp lệ với VTP createOrder — gây lỗi "Price does not apply")
      // và normalize ORDER_PAYMENT: nếu caller muốn thu hộ cả 2 (2) nhưng codMoney=0 → dùng 4
      if (orderRequest) {
        const {
          ORDER_SERVICE: _ignoredSvc,
          ORDER_TYPE: _ignoredType,
          ...safeOverride
        } = orderRequest as any;
        // Nếu ORDER_PAYMENT=2 (thu hộ tiền hàng + cước) nhưng không có tiền COD → đổi sang 4
        // vì tiền hàng đã được CK trước, chỉ cần thu cước khi giao
        if (safeOverride.ORDER_PAYMENT === 2 && (req.codMoney ?? 0) === 0) {
          logger.warn(
            '[VTP createOrder] ORDER_PAYMENT=2 nhưng codMoney=0 → tự động chuyển sang ORDER_PAYMENT=4 (chỉ thu cước)'
          );
          safeOverride.ORDER_PAYMENT = 4;
        }
        order = { ...order, ...safeOverride };
      }

      const body = pickBy(
        order,
        identity
      ) as Partial<ViettelPostCreateOrderReq>;

      const response = await fetch(`${viettelpostUrl}/order/createOrder`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          Token: this.getToken(),
        },
      });

      const json =
        await this.handleFetchResponse<ViettelPostCreateOrderData>(response);

      return { req, body, res: json, success: true };
    } catch (error) {
      return this.handleError('createOrder', error as Error);
    }
  }

  // ─── Lấy thông tin đơn ───────────────────────────────────────────────────

  /**
   * Lấy thông tin đơn hàng qua webhook (chủ động từ VTP)
   * hoặc từ response của createOrder.
   *
   * NOTE: ViettelPost không có API "GET order by ID" riêng.
   * Thông tin đơn được nhận qua:
   *   1. Response của createOrder
   *   2. Webhook push từ VTP khi có thay đổi trạng thái
   *
   * Hàm này dùng UpdateOrder TYPE không hợp lệ trong code cũ (TYPE=0).
   * Giữ lại để không break, nhưng thực tế nên dùng webhook.
   */
  public async getOrder(orderNumber: string): Promise<unknown> {
    // ViettelPost không cung cấp API GET order by ID riêng.
    // Thông tin đơn chỉ có từ:
    //   - response createOrder (lưu lại khi tạo đơn)
    //   - webhook push khi trạng thái thay đổi
    // Trả về orderNumber để caller biết đơn tồn tại
    logger.warn(
      `[ViettelPost] getOrder(${orderNumber}): VTP không có API GET order. ` +
        'Dùng webhook để nhận cập nhật trạng thái.'
    );
    return { ORDER_NUMBER: orderNumber };
  }

  // ─── Hủy đơn ─────────────────────────────────────────────────────────────

  /**
   * Hủy đơn hàng
   * POST /order/UpdateOrder với TYPE=4
   * Chỉ hủy được khi ORDER_STATUS < 200 (và khác 105, 107)
   */
  public async cancelOrder(orderNumber: string): Promise<unknown> {
    try {
      const body: ViettelPostUpdateOrderReq = {
        TYPE: 4,
        ORDER_NUMBER: orderNumber,
        NOTE: 'Hủy đơn hàng',
      };

      const response = await fetch(`${viettelpostUrl}/order/UpdateOrder`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          Token: this.getToken(),
        },
      });

      const json = (await response.json()) as ViettelPostApiResponse<null>;

      if (json.status !== 200) {
        logger.error('[ViettelPost] cancelOrder failed:', json);
        throw new Error(json.message || 'Hủy đơn hàng thất bại');
      }

      logger.info(
        `[ViettelPost] cancelOrder success: ${orderNumber} — ${json.message}`
      );
      return json;
    } catch (error) {
      return this.handleError('cancelOrder', error as Error);
    }
  }

  // ─── In vận đơn ───────────────────────────────────────────────────────────

  /**
   * Lấy link in vận đơn
   * Bước 1: POST /order/printing-code → lấy mã code
   * Bước 2: Ghép code vào URL in
   *
   * FIX: Code cũ dùng /order/encryptLinkPrint (đã lỗi thời)
   *      Tài liệu mới dùng /order/printing-code + URL digitalize
   */
  public async getOrderLabel(
    orderNumber: string,
    options?: OrderLabelOptions
  ): Promise<string> {
    try {
      // Đặt expiry = 7 ngày kể từ bây giờ
      const expiryTime = Date.now() + 7 * 24 * 60 * 60 * 1000;

      const body: ViettelPostPrintingCodeReq = {
        ORDER_ARRAY: [orderNumber],
        EXPIRY_TIME: expiryTime,
      };

      const response = await fetch(`${viettelpostUrl}/order/printing-code`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          Token: this.getToken(),
        },
      });

      const json = (await response.json()) as ViettelPostApiResponse<null>;

      if (json.status !== 200) {
        logger.error(
          '[ViettelPost] getOrderLabel (printing-code) failed:',
          json
        );
        throw new Error(json.message || 'Lấy mã in vận đơn thất bại');
      }

      const code = json.message; // mã code nằm trong field "message"

      // Chọn type theo pageSize
      const pageSize = options?.pageSize ?? 'A5';
      const type = pageSize === 'A6' ? 2 : 1;
      const showPostage = 1;

      // Dùng URL production (môi trường dev dùng dev-print.viettelpost.vn)
      const printUrl = `${PRINT_BASE_URL}?type=${type}&bill=${code}&showPostage=${showPostage}`;

      logger.info(`[ViettelPost] getOrderLabel: ${orderNumber} → ${printUrl}`);
      return printUrl;
    } catch (error) {
      return this.handleError('getOrderLabel', error as Error);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Expose để update cachedToken từ bên ngoài
   * (ví dụ: sau khi load từ DB/ExternalConfig khi server khởi động)
   */
  public static setToken(token: string): void {
    if (!token) return;
    cachedToken = token;
  }

  public static getStoredToken(): string {
    return cachedToken;
  }
}
