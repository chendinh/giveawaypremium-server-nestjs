import { Order } from '../../models/order';
import { GiaoHangTietKiem } from './giaohangtietkiem';
import { ViettelPost } from './viettelpost';
import { OrderReq, PriceEstimateReq } from './interface';

export * from './giaohangtietkiem';
export * from './viettelpost';

export const getPriceEstimate = async (service: string, req: PriceEstimateReq): Promise<number> => {
  switch (service) {
    case 'giaohangtietkiem':
      const giaohangtietkiem = new GiaoHangTietKiem({});
      return giaohangtietkiem.getPriceEstimate(req);
      break;
    case 'viettelpost':
      const viettelpost = new ViettelPost({});
      return viettelpost.getPriceEstimate(req);
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
    case 'viettelpost':
      const viettelpost = new ViettelPost({});
      return viettelpost.createOrder(req);
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
    case 'viettelpost':
      const viettelpost = new ViettelPost({});
      return viettelpost.getOrder(id);
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
    case 'viettelpost':
      const viettelpost = new ViettelPost({});
      return viettelpost.cancelOrder(id);
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
    case 'viettelpost':
      const vtpQuery = new Parse.Query(Order);
      const vtpOrder = await vtpQuery.include('transporter').get(data.orderId);
      const orderNumber = vtpOrder.get('transporter')?.get('res')?.data?.ORDER_NUMBER ?? '';
      const viettelpost = new ViettelPost({});
      return viettelpost.getOrderLabel(orderNumber);
      break;
  
    default:
      throw new Error('Transporter Service not support');
      break;
  }
}

export const loginTransporter = async (service: string, data?: { username?: string, password?: string }): Promise<any> => {
  switch (service) {
    case 'viettelpost':
      const viettelpost = new ViettelPost({});
      return viettelpost.login(data?.username, data?.password);
      break;
  
    default:
      throw new Error('Login not supported for this transporter service');
      break;
  }
}

export const getLongToken = async (service: string, data?: { token?: string }): Promise<any> => {
  switch (service) {
    case 'viettelpost':
      const viettelpost = new ViettelPost({});
      return viettelpost.getLongToken(data?.token);
      break;
  
    default:
      throw new Error('Long token not supported for this transporter service');
      break;
  }
}
