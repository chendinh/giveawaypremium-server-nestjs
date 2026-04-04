import { GHTKSTATUS, VIETTELPOST_STATUS } from "../../constants/order-status";
import { getPriceEstimate, createOrder, getOrderLabel, cancelOrder } from "../../external-services/transporter";
import { Order } from "../../models/order";
import { Transporter } from "../../models/transporter";

const getStatusByService = (service: string, statusCode: number | string): string => {
  const code = statusCode.toString();
  switch (service) {
    case 'giaohangtietkiem':
      return GHTKSTATUS[code] ?? '';
    case 'viettelpost':
      return VIETTELPOST_STATUS[code] ?? '';
    default:
      return '';
  }
}

export const priceEstimateAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<number> => {
  const { params } = request;
  const { service, data } = params;
  return getPriceEstimate(service, data);
}

export const createOrderAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<any> => {
  const { params } = request;
  const { service, data } = params;
  return createOrder(service, data);
}

export const getOrderLabelAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<any> => {
  const { params } = request;
  const { service, data } = params;
  return getOrderLabel(service, data);
}

const getTransporterOrderId = (service: string, res: any): string => {
  switch (service) {
    case 'giaohangtietkiem':
      return res.order?.label_id ?? '';
    case 'viettelpost':
      return res.data?.ORDER_NUMBER ?? '';
    default:
      return '';
  }
}

const getTransporterStatus = (service: string, response: any): { status: string; statusCode: number } => {
  switch (service) {
    case 'giaohangtietkiem': {
      const statusCode: number = response?.order?.status ?? 0;
      return { status: getStatusByService(service, statusCode), statusCode };
    }
    case 'viettelpost': {
      const statusCode: number = response?.data?.ORDER_STATUS ?? response?.status ?? 0;
      return { status: getStatusByService(service, statusCode), statusCode };
    }
    default:
      return { status: '', statusCode: 0 };
  }
}

export const cancelOrderAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<any> => {
  const { params } = request;
  const { service, data } = params;
  const { orderId } = data;
  const pointerOrder = new Order();
  pointerOrder.id = orderId;

  const order = await pointerOrder.fetch();
  const transporterPointer = order.get('transporter') as Transporter;
  if (!transporterPointer) throw new Error('This Order is not packaged');
  const transporter = await transporterPointer.fetch();
  const res = transporter.get('res');
  const transporterService = transporter.get('service') || service;
  const id = getTransporterOrderId(transporterService, res);
  const response = await cancelOrder(transporterService, id);
  const { status, statusCode } = getTransporterStatus(transporterService, response);
  if (statusCode) {
    order.unset('transporter');
    order.save({}, { useMasterKey: true });
    transporter.unset('order');
    transporter.save({
      status: status,
      res: response
    }, { useMasterKey: true });
  }
  return response;
}

export const tranporterAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<any> => {
  const { params } = request;
  const { action } = params;

  switch (action) {
    case 'PRICE_ESTIMATE':
      return priceEstimateAction(request);
      break;
    case 'CREATE_ORDER':
      const { params } = request;
      const { data, service } = params;
      const { orderId } = data;
      const pointerOrder = new Order();
      pointerOrder.id = orderId;
      const tranQuery = new Parse.Query(Transporter);
      const transporter = await tranQuery.equalTo('order', pointerOrder).first();
      if (transporter) throw new Error('This Order Already Packaged');
      pointerOrder.id = orderId;
      const result = await createOrderAction(request);
      
      const tranporter = new Transporter();
      const object = {
        ...result,
        service,
        order: pointerOrder
      }
      await tranporter.save(object, { useMasterKey: true });
      return result.res;
      break;
    case 'GET_ORDER_LABEL':
      return getOrderLabelAction(request);
      break;
    case 'CANCEL_ORDER':
      const tran = await cancelOrderAction(request);

      return tran
      break;
    default:
      throw new Error('Action not support');
      break;
  }
}
