// ─── Supported transporter services ───
export enum TransporterService {
  GHTK = 'giaohangtietkiem',
  ViettelPost = 'viettelpost',
}

// ─── Address fragments ───

/**
 * Địa chỉ dùng với ViettelPost — dùng numeric ID
 * Lấy từ API: GET /categories/listProvinceById, listDistrict, listWards
 */
export interface VTPAddress {
  province: number; // PROVINCE_ID
  district: number; // DISTRICT_ID
  ward: number; // WARDS_ID  — bắt buộc với VTP
  address: string; // địa chỉ chi tiết
  name: string;
  phone: string;
  street?: string;
}

/**
 * Địa chỉ dùng với GHTK — dùng tên tỉnh/huyện dạng string
 */
export interface GHTKAddress {
  province: string; // tên tỉnh/TP, ví dụ: "Hà Nội"
  district: string; // tên quận/huyện, ví dụ: "Quận Đống Đa"
  ward: string; // tên phường/xã
  address: string; // địa chỉ chi tiết
  name: string;
  phone: string;
  street?: string;
}

/**
 * Union type — dùng khi code chung cho cả 2 provider
 */
export type AddressBase = VTPAddress | GHTKAddress;

/** @deprecated Dùng VTPAddress hoặc GHTKAddress thay thế */
export interface FullAddress {
  province: string | number;
  district: string | number;
  ward: string | number;
  address: string;
  name: string;
  phone: string;
  street?: string;
}

// ─── Shared request types ───

export interface PriceEstimateReq {
  weight: number;
  serviceLevel: string;
  from: VTPAddress | GHTKAddress;
  to: VTPAddress | GHTKAddress;
  value: number;
  transport: string;
}

export interface OrderItem {
  name: string;
  weight: number;
  quantity: number;
}

export interface OrderReq {
  from: VTPAddress | GHTKAddress;
  to: VTPAddress | GHTKAddress;
  orderRequest?: Record<string, unknown>;
  orderId: string;
  value: number;
  serviceLevel: string;
  note?: string;
  codMoney?: number;
  isFreeShipping?: boolean;
  items: OrderItem[];
}

export interface OrderLabelOptions {
  original?: 'portrait' | 'landscape';
  pageSize?: 'A5' | 'A6';
}

export interface CreateOrderResult {
  req: OrderReq;
  body: Record<string, unknown>;
  res: unknown;
  success: boolean;
}

export interface LoginReq {
  username?: string;
  password?: string;
}

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

// ─── Constructor options (extensible per-provider) ───
export interface TransporterOption {
  [key: string]: unknown;
}

// ─── Provider contract ───
export interface Transporter {
  getPriceEstimate(req: PriceEstimateReq): Promise<number>;
  createOrder(req: OrderReq): Promise<CreateOrderResult>;
  getOrder(id: string): Promise<unknown>;
  cancelOrder(id: string): Promise<unknown>;
  getOrderLabel(id: string, options?: OrderLabelOptions): Promise<unknown>;
}
