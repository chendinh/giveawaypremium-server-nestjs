import { GHTKSTATUS } from "../../constants/order-status";
import { getPriceEstimate, createOrder, getOrderLabel, cancelOrder } from "../../external-services/transporter";
import { Order } from "../../models/order";
import { Transporter } from "../../models/transporter";

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
  const id = res.order?.label_id ?? '';
  const response = await cancelOrder(service, id);
  const status: number = response?.order?.status ?? 0;
  if (status) {
    order.unset('transporter');
    order.save({}, { useMasterKey: true });
    transporter.unset('order');
    transporter.save({
      status: GHTKSTATUS[status.toString()] ?? '',
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
