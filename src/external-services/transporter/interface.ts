// ─── Supported transporter services ───
export enum TransporterService {
  GHTK = 'giaohangtietkiem',
  ViettelPost = 'viettelpost',
}

// ─── Address fragments ───
export interface AddressBase {
  province: string;
  district: string;
  address: string;
}

export interface FullAddress extends AddressBase {
  name: string;
  ward: string;
  phone: string;
  street?: string;
}

// ─── Shared request types ───
export interface PriceEstimateReq {
  weight: number;
  serviceLevel: string;
  from: AddressBase;
  to: AddressBase;
  value: number;
  transport: string;
}

export interface OrderItem {
  name: string;
  weight: number;
  quantity: number;
}

export interface OrderReq {
  from: FullAddress;
  to: FullAddress;
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
