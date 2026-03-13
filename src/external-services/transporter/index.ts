import { Order } from '../../models/order';
import { GiaoHangTietKiem } from './giaohangtietkiem';
import { OrderReq, PriceEstimateReq } from './interface';

export * from './giaohangtietkiem';

export const getPriceEstimate = async (service: string, req: PriceEstimateReq): Promise<number> => {
  switch (service) {
    case 'giaohangtietkiem':
      const giaohangtietkiem = new GiaoHangTietKiem({});
      return giaohangtietkiem.getPriceEstimate(req);
      break;
  
    default:
      throw new Error('Transporter Service not support');
      break;
  }
}

export const createOrder = async (service: string, req: OrderReq): Promise<any> => {
  switch (service) {
    case 'giaohangtietkiem':
      const giaohangtietkiem = new GiaoHangTietKiem({});
      return giaohangtietkiem.createOrder(req);
      break;
  
    default:
      throw new Error('Transporter Service not support');
      break;
  }
}

export const getOrder = async (service: string, id: string): Promise<any> => {
  switch (service) {
    case 'giaohangtietkiem':
      const giaohangtietkiem = new GiaoHangTietKiem({});
      return giaohangtietkiem.getOrder(id);
      break;
  
    default:
      throw new Error('Transporter Service not support');
      break;
  }
}

export const cancelOrder = async (service: string, id: string): Promise<any> => {
  switch (service) {
    case 'giaohangtietkiem':
      const giaohangtietkiem = new GiaoHangTietKiem({});
      return giaohangtietkiem.cancelOrder(id);
      break;
  
    default:
      throw new Error('Transporter Service not support');
      break;
  }
}

export const getOrderLabel = async (service: string, data: { orderId: string, original?: 'portrait' | 'landscape', pageSize?: 'A5' | 'A6' }): Promise<any> => {
  switch (service) {
    case 'giaohangtietkiem':
      const query = new Parse.Query(Order);
      const order = await query.include('transporter').get(data.orderId);
      const label_id = order.get('transporter')?.get('res')?.order.label_id ?? '';
      const giaohangtietkiem = new GiaoHangTietKiem({});
      return giaohangtietkiem.getOrderLabel(label_id, { original: data.original, pageSize: data.pageSize });
      break;
  
    default:
      throw new Error('Transporter Service not support');
      break;
  }
}
