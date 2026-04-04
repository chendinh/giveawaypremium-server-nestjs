// ─── ViettelPost API request/response type contracts ───

/** POST /user/Login */
export interface ViettelPostLoginReq {
  USERNAME: string;
  PASSWORD: string;
}

export interface ViettelPostLoginData {
  token: string;
  userId: number;
  source: number;
  expired: string;
}

/** POST /user/ownerconnect */
export interface ViettelPostLongTokenData {
  token: string;
  expired: string;
}

/** POST /order/getPriceAll */
export interface ViettelPostPriceEstimateReq {
  PRODUCT_WEIGHT: number;
  PRODUCT_PRICE: number;
  MONEY_COLLECTION: number;
  ORDER_SERVICE_ADD: string;
  ORDER_SERVICE: string;
  SENDER_PROVINCE: string;
  SENDER_DISTRICT: string;
  RECEIVER_PROVINCE: string;
  RECEIVER_DISTRICT: string;
  PRODUCT_TYPE: string;
  NATIONAL_TYPE: number;
}

export interface ViettelPostPriceEstimateItem {
  MA_DV_CHINH: string;
  TEN_DICHVU: string;
  GIA_CUOC: number;
  THOI_GIAN: string;
}

/** POST /order/createOrder */
export interface ViettelPostOrderItem {
  PRODUCT_NAME: string;
  PRODUCT_WEIGHT: number;
  PRODUCT_QUANTITY: number;
  PRODUCT_PRICE: number;
}

export interface ViettelPostCreateOrderReq {
  SENDER_FULLNAME: string;
  SENDER_ADDRESS: string;
  SENDER_PHONE: string;
  SENDER_PROVINCE: string;
  SENDER_DISTRICT: string;
  SENDER_WARD: string;
  RECEIVER_FULLNAME: string;
  RECEIVER_ADDRESS: string;
  RECEIVER_PHONE: string;
  RECEIVER_PROVINCE: string;
  RECEIVER_DISTRICT: string;
  RECEIVER_WARD: string;
  PRODUCT_NAME: string;
  PRODUCT_QUANTITY: number;
  PRODUCT_PRICE: number;
  PRODUCT_WEIGHT: number;
  PRODUCT_TYPE: string;
  ORDER_PAYMENT: number;
  ORDER_SERVICE: string;
  ORDER_NOTE: string;
  MONEY_COLLECTION: number;
  LIST_ITEM: Partial<ViettelPostOrderItem>[];
  [key: string]: unknown;
}

export interface ViettelPostCreateOrderData {
  ORDER_NUMBER: string;
  MONEY_TOTAL: number;
  MONEY_TOTAL_FEE: number;
  MONEY_FEE: number;
  MONEY_COLLECTION_FEE: number;
  MONEY_OTHER_FEE: number;
  MONEY_VAS: number;
  MONEY_COLLECTION: number;
  EXPECTED_DELIVERY: string;
}

/** POST /order/UpdateOrder — get / cancel */
export interface ViettelPostUpdateOrderReq {
  TYPE: number;
  ORDER_NUMBER: string;
  NOTE?: string;
}

export interface ViettelPostOrderData {
  ORDER_NUMBER: string;
  ORDER_STATUS: number;
  STATUS_NAME: string;
  MONEY_TOTAL: number;
  MONEY_TOTAL_FEE: number;
  MONEY_COLLECTION: number;
  [key: string]: unknown;
}

/** POST /order/encryptLinkPrint */
export interface ViettelPostPrintReq {
  TYPE: number;
  ORDER_ARRAY: string[];
}

/** Generic ViettelPost API response envelope */
export interface ViettelPostApiResponse<T = unknown> {
  status: number;
  error: boolean;
  message: string;
  data: T;
}

/** Normalized results returned to callers */
export interface LoginResult {
  token: string;
  userId?: number;
  source?: number;
  expired?: string;
}

export interface LongTokenResult {
  token: string;
  expired?: string;
}

export interface CreateOrderResult {
  req: unknown;
  body: Partial<ViettelPostCreateOrderReq>;
  res: ViettelPostApiResponse<ViettelPostOrderData>;
  success: boolean;
}
