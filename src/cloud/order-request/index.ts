import moment from 'moment';
import { OrderRequestStatus } from '../../constants/order-status';
import { OrderRequest } from '../../models/order.request';

const cancelOldOrderRequest = async () => {
  const orderRequestQuery = new Parse.Query(OrderRequest);
  const date = moment().subtract(15, 'minutes');

  const orderRequests = await orderRequestQuery
    .containedIn('status', [
      OrderRequestStatus.IN_QUEUE,
      OrderRequestStatus.VALID,
    ])
    .lessThan('createdAt', date.toDate())
    .findAll();

  if (orderRequests.length) {
    const promise = orderRequests.map(orderRequest =>
      orderRequest.save(
        { status: OrderRequestStatus.CANCELLED },
        { useMasterKey: true }
      )
    );

    await Promise.all(promise);
  }
};

/**
 * Dọn dẹp OrderRequest terminal (IN_ORDER / CANCELLED / COMPLETED) cũ hơn 7 ngày.
 * Gọi từ beforeFind để không cần cron job riêng.
 * Tránh tích lũy records vô thời hạn trong DB.
 */
const cleanupOldTerminalOrderRequests = async () => {
  const cutoff = moment().subtract(7, 'days').toDate();
  const query = new Parse.Query(OrderRequest);
  query.containedIn('status', [
    OrderRequestStatus.IN_ORDER,
    OrderRequestStatus.CANCELLED,
    OrderRequestStatus.COMPLETED,
  ]);
  query.lessThan('createdAt', cutoff);

  const stale = await query.findAll({ useMasterKey: true });
  if (!stale.length) return;

  await Parse.Object.destroyAll(stale, { useMasterKey: true });
  console.log(
    `[OrderRequest] Cleaned up ${stale.length} stale terminal records`
  );
};

const updateOrderRequestQueue = async (
  orderRequest: OrderRequest,
  status?: OrderRequestStatus
) => {
  if (status) {
    await orderRequest.save({ status }, { useMasterKey: true });
  }
  const orderRequestWithInclude = await orderRequest.fetchWithInclude([
    'product',
  ]);

  const product = orderRequestWithInclude.get('product');
  const orderRequestQuery = new Parse.Query(OrderRequest);
  const date = moment().subtract(15, 'minutes');

  const orderRequestInQueue = await orderRequestQuery
    .equalTo('product', product)
    .equalTo('status', OrderRequestStatus.IN_QUEUE)
    .greaterThanOrEqualTo('createdAt', date.toDate())
    .ascending('unix')
    .first();

  if (
    orderRequestInQueue &&
    product.get('remainNumberProduct') >= orderRequestInQueue.get('count')
  ) {
    orderRequestInQueue.save(
      { status: OrderRequestStatus.VALID },
      { useMasterKey: true }
    );
  }
};

const beforeSave = async (
  request: Parse.Cloud.BeforeSaveRequest<OrderRequest>
) => {
  try {
  } catch (error) {
    throw error;
  }
};

const afterSave = async (
  request: Parse.Cloud.AfterSaveRequest<OrderRequest>
) => {
  const object = request.object;

  if (object.get('status') == OrderRequestStatus.CANCELLED) {
    updateOrderRequestQueue(object);
  }
};

const beforeFind = async (
  request: Parse.Cloud.BeforeFindRequest<OrderRequest>
) => {
  const user = request.user;
  if (user) {
    await cancelOldOrderRequest().catch(console.error);
    // Dọn dẹp records terminal cũ — chạy nền, không block query
    cleanupOldTerminalOrderRequests().catch(console.error);
  }
};

export {
  updateOrderRequestQueue,
  beforeSave,
  afterSave,
  beforeFind,
  cancelOldOrderRequest,
  cleanupOldTerminalOrderRequests,
};
