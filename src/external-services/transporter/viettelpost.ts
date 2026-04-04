import logger from '../../plugins/logger';
import {
  OrderReq, PriceEstimateReq, Transporter, TransporterOption,
  CreateOrderResult, LoginResult, LongTokenResult, OrderLabelOptions,
} from './interface';
import {
  ViettelPostApiResponse, ViettelPostLoginReq, ViettelPostLoginData,
  ViettelPostLongTokenData, ViettelPostPriceEstimateReq,
  ViettelPostPriceEstimateItem, ViettelPostCreateOrderReq,
  ViettelPostCreateOrderData, ViettelPostUpdateOrderReq,
  ViettelPostOrderData, ViettelPostPrintReq, ViettelPostOrderItem,
} from './viettelpost.types';
import fetch, { Response } from 'node-fetch';
import { viettelpostConfigs } from '../../config/viettelpost.config';
import { pickBy, identity } from 'lodash';

const { viettelpostToken, viettelpostUrl, viettelpostUsername, viettelpostPassword } = viettelpostConfigs;

let cachedToken: string = viettelpostToken;

export class ViettelPost implements Transporter {
  constructor(_options: TransporterOption) {}

  private getToken(): string {
    return cachedToken || viettelpostToken;
  }

  private async handleFetchResponse<T = unknown>(response: Response): Promise<ViettelPostApiResponse<T>> {
    const status = response.status;
    if (status === 500) throw new Error(response.statusText);
    const json = (await response.json()) as ViettelPostApiResponse<T>;

    if (status !== 200 || json.status !== 200) {
      logger.error(json);
      throw new Error(json.message || 'ViettelPost request failed');
    }

    return json;
  }

  private handleError(functionName: string, error: Error): never {
    logger.error(`ViettelPost ${functionName}. error:`, error);
    throw error;
  }

  /**
   * Login with username/password to get a short-lived access token.
   * ViettelPost API: POST /user/Login
   */
  public async login(username?: string, password?: string): Promise<LoginResult> {
    try {
      const user = username || viettelpostUsername;
      const pass = password || viettelpostPassword;

      if (!user || !pass) {
        throw new Error('ViettelPost username and password are required for login');
      }

      const body: ViettelPostLoginReq = { USERNAME: user, PASSWORD: pass };

      const result = await fetch(`${viettelpostUrl}/user/Login`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await this.handleFetchResponse<ViettelPostLoginData>(result);
      const token = json.data?.token ?? '';

      if (token) {
        cachedToken = token;
      }

      return {
        token,
        userId: json.data?.userId,
        source: json.data?.source,
        expired: json.data?.expired,
      };
    } catch (error) {
      return this.handleError('login', error as Error);
    }
  }

  /**
   * Exchange a short-lived token for a long-lived token.
   * ViettelPost API: POST /user/ownerconnect
   */
  public async getLongToken(shortToken?: string): Promise<LongTokenResult> {
    try {
      const token = shortToken || this.getToken();

      if (!token) {
        throw new Error('A short-lived token is required. Please login first.');
      }

      const result = await fetch(`${viettelpostUrl}/user/ownerconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Token': token },
      });

      const json = await this.handleFetchResponse<ViettelPostLongTokenData>(result);
      const longToken = json.data?.token ?? '';

      if (longToken) {
        cachedToken = longToken;
      }

      return {
        token: longToken,
        expired: json.data?.expired,
      };
    } catch (error) {
      return this.handleError('getLongToken', error as Error);
    }
  }

  public async getPriceEstimate(req: PriceEstimateReq): Promise<number> {
    try {
      const { from, to, weight, value, serviceLevel } = req;
      const data: ViettelPostPriceEstimateReq = {
        PRODUCT_WEIGHT: weight,
        PRODUCT_PRICE: value,
        MONEY_COLLECTION: 0,
        ORDER_SERVICE_ADD: '',
        ORDER_SERVICE: serviceLevel || 'VCN',
        SENDER_PROVINCE: from.province,
        SENDER_DISTRICT: from.district,
        RECEIVER_PROVINCE: to.province,
        RECEIVER_DISTRICT: to.district,
        PRODUCT_TYPE: 'HH',
        NATIONAL_TYPE: 1,
      };

      const result = await fetch(`${viettelpostUrl}/order/getPriceAll`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json', 'Token': this.getToken() },
      });
      const json = await this.handleFetchResponse<ViettelPostPriceEstimateItem[]>(result);
      const fee = Array.isArray(json.data)
        ? json.data[0]?.GIA_CUOC ?? 0
        : 0;

      return fee;
    } catch (error) {
      return this.handleError('getPriceEstimate', error as Error);
    }
  }

  public async createOrder(req: OrderReq): Promise<CreateOrderResult> {
    try {
      const { from, to, value, serviceLevel, note, orderRequest, items } = req;
      const productName = items.map(item => item.name).join(', ');
      const productWeight = items.reduce((sum, item) => sum + item.weight * item.quantity, 0);
      const productQty = items.reduce((sum, item) => sum + item.quantity, 0);

      let order: ViettelPostCreateOrderReq = {
        SENDER_FULLNAME: from.name,
        SENDER_ADDRESS: from.address,
        SENDER_PHONE: from.phone,
        SENDER_PROVINCE: from.province,
        SENDER_DISTRICT: from.district,
        SENDER_WARD: from.ward,
        RECEIVER_FULLNAME: to.name,
        RECEIVER_ADDRESS: to.address,
        RECEIVER_PHONE: to.phone,
        RECEIVER_PROVINCE: to.province,
        RECEIVER_DISTRICT: to.district,
        RECEIVER_WARD: to.ward,
        PRODUCT_NAME: productName,
        PRODUCT_QUANTITY: productQty,
        PRODUCT_PRICE: value,
        PRODUCT_WEIGHT: productWeight,
        PRODUCT_TYPE: 'HH',
        ORDER_PAYMENT: 3,
        ORDER_SERVICE: serviceLevel || 'VCN',
        ORDER_NOTE: note || '',
        MONEY_COLLECTION: req.codMoney ?? 0,
        LIST_ITEM: items.map(item => pickBy<Partial<ViettelPostOrderItem>>({
          PRODUCT_NAME: item.name,
          PRODUCT_WEIGHT: item.weight,
          PRODUCT_QUANTITY: item.quantity,
          PRODUCT_PRICE: 0,
        }, identity)),
      };

      if (orderRequest) {
        order = { ...order, ...orderRequest };
      }

      const body = pickBy(order, identity) as Partial<ViettelPostCreateOrderReq>;
      const result = await fetch(`${viettelpostUrl}/order/createOrder`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'Token': this.getToken() },
      });
      const json = await this.handleFetchResponse<ViettelPostCreateOrderData>(result);
      const orderNumber: string = json.data?.ORDER_NUMBER ?? '';
      const res = await this.getOrder(orderNumber);
      return { req, body, res, success: true };
    } catch (error) {
      return this.handleError('createOrder', error as Error);
    }
  }

  public async getOrder(id: string): Promise<ViettelPostApiResponse<ViettelPostOrderData>> {
    try {
      const body: ViettelPostUpdateOrderReq = { TYPE: 0, ORDER_NUMBER: id };
      const result = await fetch(`${viettelpostUrl}/order/UpdateOrder`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'Token': this.getToken() },
      });

      const status = result.status;
      if (status === 500) throw new Error(result.statusText);
      const json = (await result.json()) as ViettelPostApiResponse<ViettelPostOrderData>;

      return json;
    } catch (error) {
      return this.handleError('getOrder', error as Error);
    }
  }

  public async cancelOrder(id: string): Promise<ViettelPostApiResponse<ViettelPostOrderData>> {
    try {
      const body: ViettelPostUpdateOrderReq = {
        TYPE: 4,
        ORDER_NUMBER: id,
        NOTE: 'Hủy đơn hàng',
      };
      const result = await fetch(`${viettelpostUrl}/order/UpdateOrder`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'Token': this.getToken() },
      });

      const status = result.status;
      if (status === 500) throw new Error(result.statusText);
      const json = (await result.json()) as ViettelPostApiResponse<ViettelPostOrderData>;

      if (json.status !== 200) {
        logger.error(json);
        throw new Error(json.message || 'Cancel order failed');
      }

      return this.getOrder(id);
    } catch (error) {
      return this.handleError('cancelOrder', error as Error);
    }
  }

  public async getOrderLabel(id: string, _options?: OrderLabelOptions): Promise<string> {
    try {
      const body: ViettelPostPrintReq = { TYPE: 1, ORDER_ARRAY: [id] };
      const result = await fetch(`${viettelpostUrl}/order/encryptLinkPrint`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'Token': this.getToken() },
      });

      const status = result.status;
      if (status !== 200) {
        logger.error(result);
        const message = result.statusText ?? 'request Failed';
        throw new Error(message);
      }
      const json = (await result.json()) as ViettelPostApiResponse<unknown>;

      if (json.status !== 200) {
        throw new Error(json.message || 'Get label failed');
      }

      return json.message;
    } catch (error) {
      return this.handleError('getOrderLabel', error as Error);
    }
  }
}
