import { GHTKSTATUS, OrderRequestStatus } from '../../constants/order-status';
import { getOrder, cancelOrder } from '../../external-services/transporter';
import { Order } from '../../models/order';
import { OrderRequest } from '../../models/order.request';
import { Product } from '../../models/product';
import { Transporter } from '../../models/transporter';
import { updateOrderRequestQueue } from '../order-request';

const updateStatusTransporter = async (order: Order) => {
  const transporterPointer = order.get('transporter') as Transporter;
  if (!transporterPointer) {
    return;
  }
  const transporter = await transporterPointer.fetch();
  const res = transporter.get('res');
  const id = res.order?.label_id ?? '';
  if (id) {
    const response = await getOrder('giaohangtietkiem', id);

    const status: number = response?.order?.status ?? 0;
    if (status) {
      transporter.save({
        status: GHTKSTATUS[status.toString()],
        res: response
      }, { useMasterKey: true });
    } 
  }
}

const cancelOrderTransporter = async (order: Order) => {
  const transporterPointer = order.get('transporter') as Transporter;
  if (!transporterPointer) {
    return;
  }
  const transporter = await transporterPointer.fetch();
  const res = transporter.get('res');
  const id = res.order?.label_id ?? '';
  if (id) {
    const response = await cancelOrder('giaohangtietkiem', id);
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
  }
}



const afterCreate = async (request: Parse.Cloud.AfterSaveRequest) => {
  const order = request.object;
  const productList = order.get('productList');
  const promise = productList.map( async (product) => {
    const productPointer = new Product();
    productPointer.id = product.objectId;
    const prod = await productPointer.fetch();
    prod.increment('soldNumberProduct', product.count)
    prod.decrement('remainNumberProduct', product.count)
    return prod.save(undefined, { useMasterKey: true });
  });
  await Promise.all(promise);

  if (order.has('orderRequest')) {
    const orderRequest = order.get('orderRequest') as OrderRequest;
    updateOrderRequestQueue(orderRequest, OrderRequestStatus.IN_ORDER);
  }
}

const afterDelete = async (request: Parse.Cloud.AfterSaveRequest<Order>) => {
  const order = request.object;
  const productList = order.get('productList');
  const promise = productList.map((product) => {
    const productPointer = new Product();
    productPointer.id = product.objectId;
    productPointer.decrement('soldNumberProduct', product.count)
    productPointer.increment('remainNumberProduct', product.count)
    return productPointer.save(undefined, { useMasterKey: true });
  });
  Promise.all(promise);
  cancelOrderTransporter(order).catch(console.error);
}

const beforeSave = async (request: Parse.Cloud.BeforeSaveRequest<Order>) => {
  try {
    const context = request.context;
    const order = request.object;
    if (order.isNew()) {
      context.isNew = true;
    }
    if (order.dirty('deletedAt') && order.get('deletedAt')) {
      context.isDeleted = true
    }
    request.context = context;
  } catch (error) {
    throw error;
  }
};

const afterSave = async (request: Parse.Cloud.AfterSaveRequest<Order>) => {
  const context = request.context;

  if (context.isNew) afterCreate(request);
  if (context.isDeleted) afterDelete(request);
}

const afterFind = async (request: Parse.Cloud.AfterFindRequest<Order>) => {
  const orders = request.objects;
  const user = request.user;
  if (user) {
    orders.forEach((order) => updateStatusTransporter(order));
  }
}


export {
  beforeSave,
  afterSave,
  afterFind
};
