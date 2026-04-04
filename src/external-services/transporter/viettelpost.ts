import logger from '../../plugins/logger';
import { OrderReq, PriceEstimateReq, Transporter, TransporterOption } from './interface';
import fetch, { Response } from 'node-fetch';
import { viettelpostConfigs } from '../../config/viettelpost.config';
import { pickBy, identity } from 'lodash';

const { viettelpostToken, viettelpostUrl } = viettelpostConfigs;

export class ViettelPost implements Transporter {
  constructor(options: TransporterOption) {

  }

  private async handleFetchResponse(response: Response): Promise<any> {
    const status = response.status;
    if (status === 500) throw new Error(response.statusText);
    const json = await response.json();

    if (status !== 200 || json.status !== 200) {
      logger.error(json);
      throw new Error(json.message || 'ViettelPost request failed');
    }

    return json;
  }

  private handleError(functionName: string, error: Error): any {
    logger.error(`ViettelPost ${functionName}. error: %s ${JSON.stringify(error)}`);

    throw error;
  }

  public async getPriceEstimate(req: PriceEstimateReq): Promise<number> {
    try {
      const { from, to, weight, value, serviceLevel } = req;
      const data = {
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
        headers: {
          'Content-Type': 'application/json',
          'Token': viettelpostToken,
        },
      });
      const json = await this.handleFetchResponse(result);
      const fee = Array.isArray(json) 
        ? json[0]?.GIA_CUOC ?? 0
        : json.data?.[0]?.GIA_CUOC ?? 0;

      return fee as number;
    } catch (error) {
      return this.handleError('getPriceEstimate', error as Error);
    }
  }

  public async createOrder(req: OrderReq): Promise<any> {
    try {
      const { from, to, value, serviceLevel, note, orderRequest, items } = req;
      const productName = items.map(item => item.name).join(', ');
      const productWeight = items.reduce((sum, item) => sum + item.weight * item.quantity, 0);
      const productQty = items.reduce((sum, item) => sum + item.quantity, 0);

      let order: any = {
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
        LIST_ITEM: items.map(item => pickBy({
          PRODUCT_NAME: item.name,
          PRODUCT_WEIGHT: item.weight,
          PRODUCT_QUANTITY: item.quantity,
          PRODUCT_PRICE: 0,
        }, identity)),
      };

      if (orderRequest) {
        order = {
          ...order,
          ...orderRequest,
        };
      }

      const body = pickBy(order, identity);
      console.log(body);
      const result = await fetch(`${viettelpostUrl}/order/createOrder`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          'Token': viettelpostToken,
        },
      });
      const json = await this.handleFetchResponse(result);
      const orderNumber: string = json.data?.ORDER_NUMBER ?? '';
      const res = await this.getOrder(orderNumber);
      return { req, body, res, success: true };
    } catch (error) {
      return this.handleError('createOrder', error as Error);
    }
  }

  public async getOrder(id: string): Promise<any> {
    try {
      const result = await fetch(`${viettelpostUrl}/order/UpdateOrder`, {
        method: 'POST',
        body: JSON.stringify({
          TYPE: 0,
          ORDER_NUMBER: id,
        }),
        headers: {
          'Content-Type': 'application/json',
          'Token': viettelpostToken,
        },
      });

      const status = result.status;
      if (status === 500) throw new Error(result.statusText);
      const json = await result.json();

      return json;
    } catch (error) {
      return this.handleError('getOrder', error as Error);
    }
  }

  public async cancelOrder(id: string): Promise<any> {
    try {
      const result = await fetch(`${viettelpostUrl}/order/UpdateOrder`, {
        method: 'POST',
        body: JSON.stringify({
          TYPE: 4,
          ORDER_NUMBER: id,
          NOTE: 'Hủy đơn hàng',
        }),
        headers: {
          'Content-Type': 'application/json',
          'Token': viettelpostToken,
        },
      });

      const status = result.status;
      if (status === 500) throw new Error(result.statusText);
      const json = await result.json();

      if (json.status !== 200) {
        logger.error(json);
        throw new Error(json.message || 'Cancel order failed');
      }

      return this.getOrder(id);
    } catch (error) {
      return this.handleError('cancelOrder', error as Error);
    }
  }

  public async getOrderLabel(id: string, options?: { original?: 'portrait' | 'landscape', pageSize?: 'A5' | 'A6' }): Promise<any> {
    try {
      const result = await fetch(`${viettelpostUrl}/order/encryptLinkPrint`, {
        method: 'POST',
        body: JSON.stringify({
          TYPE: 1,
          ORDER_ARRAY: [id],
        }),
        headers: {
          'Content-Type': 'application/json',
          'Token': viettelpostToken,
        },
      });

      const status = result.status;
      if (status !== 200) {
        logger.error(result);
        const message = result.statusText ?? 'request Failed';
        throw new Error(message);
      }
      const json = await result.json();

      if (json.status !== 200) {
        throw new Error(json.message || 'Get label failed');
      }

      return json.message;
    } catch (error) {
      return this.handleError('getOrderLabel', error as Error);
    }
  }
}
