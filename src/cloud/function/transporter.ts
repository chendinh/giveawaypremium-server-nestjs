import {
  getStatusByService,
  getTransporterOrderId,
  getStatusFromResponse,
} from '../../common/transporter.utils';
import {
  getPriceEstimate,
  createOrder,
  getOrderLabel,
  cancelOrder,
  loginTransporter,
  getLongToken,
  loginBySecretKey,
} from '../../external-services/transporter';
import {
  CreateOrderResult,
  LoginResult,
  LongTokenResult,
} from '../../external-services/transporter/interface';
import { Order } from '../../models/order';
import { Transporter } from '../../models/transporter';
import { saveTokenToDB } from '../../external-services/transporter/viettelpost.token.service';

export const getServicesAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<unknown> => {
  const { params } = request;
  const { service, data } = params;
  const {
    fromProvince,
    fromDistrict,
    fromWard,
    toProvince,
    toDistrict,
    toWard,
    weight,
  } = data;

  if (service !== 'viettelpost') throw new Error('Only viettelpost supported');

  const vtp = new (
    await import('../../external-services/transporter/viettelpost')
  ).ViettelPost({});
  const services = await vtp.getServices({
    SENDER_PROVINCE: Number(fromProvince),
    SENDER_DISTRICT: Number(fromDistrict),
    SENDER_WARD: Number(fromWard),
    RECEIVER_PROVINCE: Number(toProvince),
    RECEIVER_DISTRICT: Number(toDistrict),
    RECEIVER_WARD: Number(toWard),
    PRODUCT_TYPE: 'HH',
    PRODUCT_WEIGHT: weight || 500,
    PRODUCT_PRICE: 0,
    MONEY_COLLECTION: 0,
    TYPE: 1,
  });

  return services.map(s => ({
    code: s.MA_DV_CHINH,
    name: s.TEN_DICHVU,
    price: s.GIA_CUOC,
    time: s.THOI_GIAN,
  }));
};

export const priceEstimateAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<number> => {
  const { params } = request;
  const { service, data } = params;
  return getPriceEstimate(service, data);
};

export const createOrderAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<CreateOrderResult> => {
  const { params } = request;
  const { service, data } = params;
  return createOrder(service, data);
};

export const getOrderLabelAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<unknown> => {
  const { params } = request;
  const { service, data } = params;
  return getOrderLabel(service, data);
};

export const loginAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<LoginResult> => {
  const { params } = request;
  const { service, data } = params;
  return loginTransporter(service, data);
};

export const getLongTokenAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<LongTokenResult> => {
  const { params } = request;
  const { service, data } = params;
  const result = await getLongToken(service, data);
  // Tự động lưu long token vào DB để tồn tại qua restart
  if (service === 'viettelpost' && result.token) {
    await saveTokenToDB(result.token);
  }
  return result;
};

/**
 * Lấy long token bằng secret key từ website viettelpost.vn
 * Params: { service: 'viettelpost', data: { secretKey: '...' } }
 */
export const loginBySecretKeyAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<LongTokenResult> => {
  const { params } = request;
  const { service, data } = params;
  if (!data?.secretKey) {
    throw new Error('secretKey is required');
  }
  const result = await loginBySecretKey(service, data.secretKey);
  // Tự động lưu long token vào DB
  if (service === 'viettelpost' && result.token) {
    await saveTokenToDB(result.token);
  }
  return result;
};

export const cancelOrderAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<unknown> => {
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
  const statusCode = getStatusFromResponse(transporterService, response);
  const status = getStatusByService(transporterService, statusCode);

  // VTP cancelOrder thành công trả về data=null, status=200
  // Kiểm tra cả trường hợp response.status === 200 (thành công)
  const isCancelled =
    statusCode > 0 ||
    (response as any)?.status === 200 ||
    (response as any)?.message?.includes('thành công');

  if (isCancelled) {
    order.unset('transporter');
    await order.save({}, { useMasterKey: true });
    transporter.unset('order');
    await transporter.save(
      {
        status: status || 'CANCELLED',
        res: response,
      },
      { useMasterKey: true }
    );
  }
  return response;
};

export const tranporterAction = async (
  request: Parse.Cloud.FunctionRequest
): Promise<unknown> => {
  const { params, user, master } = request;
  const { action } = params;

  // ─── Phân quyền theo action ───────────────────────────────────────────────
  // Actions chỉ dành cho admin (master key)
  const MASTER_ONLY_ACTIONS = [
    'LOGIN',
    'GET_LONG_TOKEN',
    'LOGIN_BY_SECRET_KEY',
  ];
  // Actions yêu cầu user đăng nhập (hoặc master key)
  const AUTH_REQUIRED_ACTIONS = [
    'CREATE_ORDER',
    'CANCEL_ORDER',
    'GET_ORDER_LABEL',
    'GET_ORDER_STATUS',
  ];

  if (MASTER_ONLY_ACTIONS.includes(action) && !master) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      `Action ${action} yêu cầu master key`
    );
  }

  if (AUTH_REQUIRED_ACTIONS.includes(action) && !user && !master) {
    throw new Parse.Error(
      Parse.Error.SESSION_MISSING,
      `Action ${action} yêu cầu đăng nhập`
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  switch (action) {
    case 'PRICE_ESTIMATE':
      return priceEstimateAction(request);
      break;
    case 'GET_SERVICES':
      return getServicesAction(request);
      break;
    case 'CREATE_ORDER':
      const { params } = request;
      const { data, service } = params;
      const { orderId } = data;
      const pointerOrder = new Order();
      pointerOrder.id = orderId;
      const tranQuery = new Parse.Query(Transporter);
      const transporter = await tranQuery
        .equalTo('order', pointerOrder)
        .first();
      if (transporter) throw new Error('This Order Already Packaged');
      const result = await createOrderAction(request);

      const tranporter = new Transporter();
      // Chỉ lưu 'res' (response từ provider) — không lưu req/body để tiết kiệm DB
      const object = {
        res: result.res,
        service,
        order: pointerOrder,
      };
      await tranporter.save(object, { useMasterKey: true });
      return result.res;
      break;
    case 'GET_ORDER_LABEL':
      return getOrderLabelAction(request);
      break;
    case 'GET_ORDER_STATUS': {
      // Lấy trạng thái đơn VTP theo orderId (Parse objectId của Order)
      // Tự động cập nhật Transporter.status + vtpStatus trong DB
      const { params: p } = request;
      const { data: d, service: svc } = p;
      const { orderId: oid } = d;
      if (svc !== 'viettelpost') throw new Error('Only viettelpost supported');

      const oQuery = new Parse.Query(Order);
      const oObj = await oQuery.include('transporter').get(oid);
      const tPtr = oObj.get('transporter');
      if (!tPtr) throw new Error('Đơn này chưa có vận đơn');
      const tObj = await tPtr.fetch({ useMasterKey: true });

      const savedRes = tObj.get('res');
      const orderNumber =
        savedRes?.data?.ORDER_NUMBER || savedRes?.ORDER_NUMBER;
      if (!orderNumber) throw new Error('Không tìm thấy mã vận đơn VTP');

      const vtp = new (
        await import('../../external-services/transporter/viettelpost')
      ).ViettelPost({});
      const detail = (await vtp.getOrderStatus(orderNumber)) as any;

      if (detail?.data?.ORDER_STATUS != null) {
        const { getStatusByService } =
          await import('../../common/transporter.utils');
        const VIETTELPOST_STATUS = (
          await import('../../constants/order-status')
        ).VIETTELPOST_STATUS;
        const vtpCode: number = detail.data.ORDER_STATUS;
        const normalizedStatus =
          VIETTELPOST_STATUS[String(vtpCode)] || tObj.get('status');

        await tObj.save(
          {
            status: normalizedStatus,
            vtpStatus: vtpCode,
            vtpStatusName: detail.data.ORDER_STATUSDATE
              ? `${vtpCode}`
              : String(vtpCode),
          },
          { useMasterKey: true }
        );
      }

      return detail;
    }
    case 'CANCEL_ORDER':
      const tran = await cancelOrderAction(request);

      return tran;
      break;
    case 'LOGIN':
      return loginAction(request);
      break;
    case 'GET_LONG_TOKEN':
      return getLongTokenAction(request);
      break;
    case 'LOGIN_BY_SECRET_KEY':
      return loginBySecretKeyAction(request);
      break;
    default:
      throw new Error('Action not support');
      break;
  }
};
