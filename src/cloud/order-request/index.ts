import moment from 'moment';
import { OrderRequestStatus } from "../../constants/order-status";
import { OrderRequest } from "../../models/order.request";

const cancelOldOrderRequest = async () => {
  const orderRequestQuery = new Parse.Query(OrderRequest);
  const date = moment().subtract(15, 'minutes');

  const orderRequests = await orderRequestQuery
    .containedIn('status', [OrderRequestStatus.IN_QUEUE, OrderRequestStatus.VALID])
    .lessThan('createdAt', date.toDate())
    .findAll();
  
  if (orderRequests.length) {
    const promise = orderRequests.map((orderRequest) => orderRequest.save(
      { status: OrderRequestStatus.CANCELLED },
      { useMasterKey: true }
    ));

    await Promise.all(promise);
  }
  
}

const updateOrderRequestQueue = async (orderRequest: OrderRequest, status?: OrderRequestStatus) => {
  if (status) {
    orderRequest.save(
      { status },
      { useMasterKey: true }
    )
  }
  const orderRequestWithInclude = await orderRequest.fetchWithInclude(['product']);

  const product = orderRequestWithInclude.get('product')
  const orderRequestQuery = new Parse.Query(OrderRequest);
  const date = moment().subtract(15, 'minutes');

  const orderRequestInQueue = await orderRequestQuery
    .equalTo('product', product)
    .equalTo('status', OrderRequestStatus.IN_QUEUE)
    .greaterThanOrEqualTo('createdAt', date.toDate())
    .ascending('unix')
    .first();

  if (orderRequestInQueue && product.get('remainNumberProduct') >= orderRequestInQueue.get('count')) {
    orderRequestInQueue.save(
      { status: OrderRequestStatus.VALID },
      { useMasterKey: true }
    )
  }
}

const beforeSave = async (request: Parse.Cloud.BeforeSaveRequest<OrderRequest>) => {
  try {

  } catch (error) {
    throw error;
  }
};

const afterSave = async (request: Parse.Cloud.AfterSaveRequest<OrderRequest>) => { 
  const object = request.object;

  if (object.get('status') == OrderRequestStatus.CANCELLED) {
    updateOrderRequestQueue(object);
  }
}

const beforeFind = async (request: Parse.Cloud.BeforeFindRequest<OrderRequest>) => {
  const user = request.user
  if (user) {
    await cancelOldOrderRequest().catch(console.error);
  }
  
  
}

export {
  updateOrderRequestQueue,
  beforeSave,
  afterSave,
  beforeFind,
  cancelOldOrderRequest
};
