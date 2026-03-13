import moment from 'moment';
import PQueue from 'p-queue';
import { OrderRequest } from '../../models/order.request';
import { Product } from '../../models/product';
import sum = require('lodash/sum');
import { OrderRequestStatus } from '../../constants/order-status';

const queue = new PQueue({ concurrency: 1 });

const requestOrder = async (productId: string, count: number): Promise<OrderRequest> => {
  const productQuery = new Parse.Query(Product);
  const product = await productQuery
    .equalTo('objectId', productId)
    .first();
  if (!product) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `invalid product ${productId}`);
 
  const date = moment().subtract(15, 'minutes');
  const orderRequsetuery = new Parse.Query(OrderRequest);
  const orderRequests = await orderRequsetuery
    .equalTo('product', product.toPointer())
    .containedIn('status', [OrderRequestStatus.IN_QUEUE, OrderRequestStatus.VALID])
    .greaterThanOrEqualTo('createdAt', date.toDate())
    .findAll();

  const orderCounts = orderRequests.map(orderRequest => orderRequest.get('count') as number ?? 0)
  
  if (sum(orderCounts) + count > product.get('remainNumberProduct') * 2) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `Too Many Order`);
  }

  const status = (sum(orderCounts) + count <= product.get('remainNumberProduct')) 
    ? OrderRequestStatus.VALID 
    : OrderRequestStatus.IN_QUEUE
  const unix = Date.now();

  const orderRequest = new OrderRequest();

  return orderRequest.save({
    product,
    status,
    unix,
    count,
  }, { useMasterKey: true });
}

export const requestOrderGuest = async (
  request: Parse.Cloud.FunctionRequest<{productId: string; count: number}>
): Promise<any> => {
  const { productId, count } = request.params;

  const orderRequest = await queue.add<OrderRequest>(() => requestOrder(productId, count));

  return orderRequest;
};
