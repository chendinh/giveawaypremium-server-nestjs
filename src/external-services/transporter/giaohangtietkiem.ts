import logger from '../../plugins/logger';
import { OrderReq, PriceEstimateReq, Transporter, TransporterOption } from './interface';
import fetch, { Response } from 'node-fetch';
import { URLSearchParams } from 'url';
import { ghtkConfigs } from '../../config/ghtk.config';
import { pickBy, identity } from 'lodash';
import { generate } from "randomstring"; 

const { ghtkToken, ghtkUrl } = ghtkConfigs;

export class GiaoHangTietKiem implements Transporter {
  constructor(options: TransporterOption) {
		
	}

  private async hanldeFetchResponse(response: Response): Promise<any> {
    const status = response.status;
    if (status === 500) throw new Error(response.statusText);
    const json = await response.json();

    if (status !== 200 || !json.success) {
      logger.error(json);
      throw new Error(json.message);
    } 

    return json;
  }

  private handleError(functionName: string, error: Error): any {
    logger.error(`GiaoHangTietKiem ${functionName}. error: %s ${JSON.stringify(error)}`);

    throw error;
  }

  public async getPriceEstimate(req: PriceEstimateReq): Promise<number> {
    try {
      const { from, to, weight, value, serviceLevel, transport } = req
      const data = {
        pick_address: from.address,
        pick_province: from.province,
        pick_district: from.district,
        province: to.province,
        district: to.district,
        address: to.address,
        weight: weight.toString(),
        value: value.toString(),
        deliver_option: serviceLevel,
        transport, 
      };
      
      const result = await fetch(`${ghtkUrl}/services/shipment/fee?${new URLSearchParams(data)}`, { method: 'GET', headers: { Token: ghtkToken} });
      const json = await this.hanldeFetchResponse(result);
      const fee = json.fee?.fee as number;

      return fee;
    } catch (error) {
      return this.handleError('getPriceEstimate', error as Error);
    }
  }

  public async createOrder(req: OrderReq): Promise<any> {
    try {
      const { from, to, value, serviceLevel, note, orderRequest } = req
      const products = req.items.map((item) => pickBy({
        name: item.name,
        weight: item.weight,
        quantity: item.quantity,
      }, identity));
      let order = {
        id: generate(12),
        pick_name: from.name,
        pick_address: from.address,
        pick_province: from.province,
        pick_district: from.district,
        pick_ward: from.ward,
        pick_tel: from.phone,
        pick_street: from.street,
        street: to.street,
        tel: to.phone,
        name: to.name,
        address: to.address,
        province: to.province,
        district: to.district,
        ward: to.ward,
        hamlet: 'Khác',
        is_freeship: 0,
        pick_money: 0,
        note: note,
        value: value,
        transport: serviceLevel
      };
      if (orderRequest) {
        order = {
          ...order,
          ...orderRequest
        }
      }
      const body = { order: pickBy(order, identity), products };
      console.log(body);
      const result = await fetch(`${ghtkUrl}/services/shipment/order`, { 
        method: 'POST', 
        body: JSON.stringify(body),
        headers: { Token: ghtkToken, 'Content-Type': 'application/json' } }
      );
      const json = await this.hanldeFetchResponse(result);
      const labelId: string = json.order?.label ?? '';
      const res = await this.getOrder(labelId);
      return { req, body, res, success: true };
    } catch (error) {
      return this.handleError('createOrder', error as Error);
    }
  }

  public async getOrder(id: string): Promise<any> {
    try {
      const result = await fetch(`${ghtkUrl}/services/shipment/v2/${id}`, { method: 'GET', headers: { Token: ghtkToken} });
      const json = await this.hanldeFetchResponse(result);

      return json;
    } catch (error) {
      return this.handleError('getOrder', error as Error);
    }
  }

  public async cancelOrder(id: string): Promise<any> {
    try {
      await fetch(`${ghtkUrl}/services/shipment/cancel/${id}`, { method: 'POST', headers: { Token: ghtkToken} });

      return this.getOrder(id);
    } catch (error) {
      return this.handleError('cancelOrder', error as Error);
    }
  }
  public async getOrderLabel(id: string, options?: { original?: 'portrait' | 'landscape', pageSize?: 'A5' | 'A6' }): Promise<any> {
    try {
      const original = options?.original ?? 'portrait';
      const pageSize = options?.pageSize ?? 'A6';
      const response = await fetch(`${ghtkUrl}/services/label/${id}?original=${original}&page_size=${pageSize}`, { method: 'GET', headers: { Token: ghtkToken} });
      const status = response.status;
      if (status !== 200) {
        logger.error(response);
        const message = response.statusText ?? 'request Failed';
        throw new Error(message);
      }
      const json = await response.buffer();

      return json.toString('base64');
    } catch (error) {
      return this.handleError('getLabelOrder', error as Error);
    }
  }
}
