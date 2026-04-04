import { Order } from '../../models/order';
import { GiaoHangTietKiem } from './giaohangtietkiem';
import { ViettelPost } from './viettelpost';
import {
  OrderReq, PriceEstimateReq, CreateOrderResult,
  LoginReq, LoginResult, LongTokenResult, OrderLabelOptions,
  TransporterService,
} from './interface';

export * from './giaohangtietkiem';
export * from './viettelpost';

export const getPriceEstimate = async (service: string, req: PriceEstimateReq): Promise<number> => {
  switch (service) {
    case TransporterService.GHTK: {
      const giaohangtietkiem = new GiaoHangTietKiem({});
      return giaohangtietkiem.getPriceEstimate(req);
    }
    case TransporterService.ViettelPost: {
      const viettelpost = new ViettelPost({});
      return viettelpost.getPriceEstimate(req);
    }
    default:
      throw new Error('Transporter Service not support');
  }
}

export const createOrder = async (service: string, req: OrderReq): Promise<CreateOrderResult> => {
  switch (service) {
    case TransporterService.GHTK: {
      const giaohangtietkiem = new GiaoHangTietKiem({});
      return giaohangtietkiem.createOrder(req);
    }
    case TransporterService.ViettelPost: {
      const viettelpost = new ViettelPost({});
      return viettelpost.createOrder(req);
    }
    default:
      throw new Error('Transporter Service not support');
  }
}

export const getOrder = async (service: string, id: string): Promise<unknown> => {
  switch (service) {
    case TransporterService.GHTK: {
      const giaohangtietkiem = new GiaoHangTietKiem({});
      return giaohangtietkiem.getOrder(id);
    }
    case TransporterService.ViettelPost: {
      const viettelpost = new ViettelPost({});
      return viettelpost.getOrder(id);
    }
    default:
      throw new Error('Transporter Service not support');
  }
}

export const cancelOrder = async (service: string, id: string): Promise<unknown> => {
  switch (service) {
    case TransporterService.GHTK: {
      const giaohangtietkiem = new GiaoHangTietKiem({});
      return giaohangtietkiem.cancelOrder(id);
    }
    case TransporterService.ViettelPost: {
      const viettelpost = new ViettelPost({});
      return viettelpost.cancelOrder(id);
    }
    default:
      throw new Error('Transporter Service not support');
  }
}

export const getOrderLabel = async (service: string, data: { orderId: string } & OrderLabelOptions): Promise<unknown> => {
  switch (service) {
    case TransporterService.GHTK: {
      const query = new Parse.Query(Order);
      const order = await query.include('transporter').get(data.orderId);
      const label_id = order.get('transporter')?.get('res')?.order.label_id ?? '';
      const giaohangtietkiem = new GiaoHangTietKiem({});
      return giaohangtietkiem.getOrderLabel(label_id, { original: data.original, pageSize: data.pageSize });
    }
    case TransporterService.ViettelPost: {
      const vtpQuery = new Parse.Query(Order);
      const vtpOrder = await vtpQuery.include('transporter').get(data.orderId);
      const orderNumber = vtpOrder.get('transporter')?.get('res')?.data?.ORDER_NUMBER ?? '';
      const viettelpost = new ViettelPost({});
      return viettelpost.getOrderLabel(orderNumber);
    }
    default:
      throw new Error('Transporter Service not support');
  }
}

export const loginTransporter = async (service: string, data?: LoginReq): Promise<LoginResult> => {
  switch (service) {
    case TransporterService.ViettelPost: {
      const viettelpost = new ViettelPost({});
      return viettelpost.login(data?.username, data?.password);
    }
    default:
      throw new Error('Login not supported for this transporter service');
  }
}

export const getLongToken = async (service: string, data?: { token?: string }): Promise<LongTokenResult> => {
  switch (service) {
    case TransporterService.ViettelPost: {
      const viettelpost = new ViettelPost({});
      return viettelpost.getLongToken(data?.token);
    }
    default:
      throw new Error('Long token not supported for this transporter service');
  }
}
