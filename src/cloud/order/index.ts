import {
  getStatusByService,
  getTransporterOrderId,
  getStatusFromResponse,
} from '../../common/transporter.utils';
import { OrderRequestStatus } from '../../constants/order-status';
import { getOrder, cancelOrder } from '../../external-services/transporter';
import { Order } from '../../models/order';
import { OrderRequest } from '../../models/order.request';
import { Product } from '../../models/product';
import { StockLog, StockLogReason } from '../../models/stock.log';
import { Transporter } from '../../models/transporter';
import { updateOrderRequestQueue } from '../order-request';

/**
 * Ghi StockLog cho một product.
 * Fire-and-forget — không block luồng chính.
 */
const writeStockLog = (
  productId: string,
  orderId: string,
  delta: number,
  reason: StockLogReason,
  snapshot: {
    remainBefore: number;
    remainAfter: number;
    soldBefore: number;
    soldAfter: number;
  }
) => {
  const log = new StockLog();
  const productPointer = new Product();
  productPointer.id = productId;
  log
    .save(
      { product: productPointer, orderId, delta, reason, snapshot },
      { useMasterKey: true }
    )
    .catch(err =>
      console.error(
        `[StockLog] Failed to write log for product ${productId}:`,
        err?.message
      )
    );
};

const updateStatusTransporter = async (order: Order) => {
  const transporterPointer = order.get('transporter') as Transporter;
  if (!transporterPointer) {
    return;
  }
  const transporter = await transporterPointer.fetch();
  const service = transporter.get('service') || 'giaohangtietkiem';

  // ViettelPost: không có API GET order — trạng thái nhận qua webhook
  // GHTK: có thể poll được
  if (service === 'viettelpost') {
    return;
  }

  const res = transporter.get('res');
  const id = getTransporterOrderId(service, res);
  if (id) {
    const response = await getOrder(service, id);
    const statusCode = getStatusFromResponse(service, response);
    if (statusCode) {
      transporter.save(
        {
          status: getStatusByService(service, statusCode),
          res: response,
        },
        { useMasterKey: true }
      );
    }
  }
};

const cancelOrderTransporter = async (order: Order) => {
  const transporterPointer = order.get('transporter') as Transporter;
  if (!transporterPointer) {
    return;
  }
  const transporter = await transporterPointer.fetch();
  const res = transporter.get('res');
  const service = transporter.get('service') || 'giaohangtietkiem';
  const id = getTransporterOrderId(service, res);
  if (id) {
    const response = await cancelOrder(service, id);
    const statusCode = getStatusFromResponse(service, response);

    // VTP cancelOrder thành công trả về data=null, statusCode = 0
    // Cần check thêm response.status === 200 hoặc message thành công
    const isCancelled =
      statusCode > 0 ||
      (response as any)?.status === 200 ||
      (response as any)?.message?.toLowerCase().includes('thành công');

    if (isCancelled) {
      order.unset('transporter');
      order.save({}, { useMasterKey: true });
      transporter.unset('order');
      transporter.save(
        {
          status:
            statusCode > 0
              ? getStatusByService(service, statusCode)
              : 'CANCELLED',
          res: response,
        },
        { useMasterKey: true }
      );
    }
  }
};

const afterCreate = async (request: Parse.Cloud.AfterSaveRequest) => {
  try {
    const order = request.object;
    const productList = order.get('productList') || [];
    const promise = productList
      .filter((product: any) => product?.objectId) // skip nếu không có objectId
      .map(async (product: any) => {
        try {
          const productPointer = new Product();
          productPointer.id = product.objectId;
          const prod = await productPointer.fetch({ useMasterKey: true });

          // Không decrement stock cho product đã soft-delete
          if (prod.get('deletedAt')) {
            console.warn(
              `[Order afterCreate] Product ${product.objectId} is soft-deleted, skipping stock update`
            );
            return null;
          }

          const remainBefore = prod.get('remainNumberProduct') ?? 0;
          const soldBefore = prod.get('soldNumberProduct') ?? 0;

          prod.increment('soldNumberProduct', product.count);
          prod.decrement('remainNumberProduct', product.count);
          await prod.save(undefined, { useMasterKey: true });

          writeStockLog(
            product.objectId,
            order.id,
            -product.count,
            StockLogReason.ORDER_CREATED,
            {
              remainBefore,
              remainAfter: remainBefore - product.count,
              soldBefore,
              soldAfter: soldBefore + product.count,
            }
          );
          return;
        } catch (err) {
          // Product không tìm thấy — log nhưng không crash
          console.error(
            `[Order afterCreate] Product ${product.objectId} not found:`,
            err?.message || err
          );
          return null;
        }
      });
    await Promise.all(promise);

    if (order.has('orderRequest')) {
      const orderRequest = order.get('orderRequest') as OrderRequest;
      updateOrderRequestQueue(orderRequest, OrderRequestStatus.IN_ORDER);
    }
  } catch (err) {
    console.error('[Order afterCreate] error:', err?.message || err);
  }
};
const afterDelete = async (request: Parse.Cloud.AfterSaveRequest<Order>) => {
  const order = request.object;
  const productList = order.get('productList') || [];
  const promise = productList
    .filter((product: any) => product?.objectId)
    .map(async (product: any) => {
      const productPointer = new Product();
      productPointer.id = product.objectId;

      // Fetch để lấy snapshot trước khi hoàn stock
      try {
        const prod = await productPointer.fetch({ useMasterKey: true });
        const remainBefore = prod.get('remainNumberProduct') ?? 0;
        const soldBefore = prod.get('soldNumberProduct') ?? 0;

        prod.decrement('soldNumberProduct', product.count);
        prod.increment('remainNumberProduct', product.count);
        await prod.save(undefined, { useMasterKey: true });

        writeStockLog(
          product.objectId,
          order.id,
          +product.count,
          StockLogReason.ORDER_DELETED,
          {
            remainBefore,
            remainAfter: remainBefore + product.count,
            soldBefore,
            soldAfter: soldBefore - product.count,
          }
        );
      } catch (err) {
        console.error(
          `[Order afterDelete] Product ${product.objectId} error:`,
          err?.message
        );
      }
    });
  await Promise.all(promise);
  cancelOrderTransporter(order).catch(console.error);
};

const beforeSave = async (request: Parse.Cloud.BeforeSaveRequest<Order>) => {
  try {
    const context = request.context;
    const order = request.object;
    if (order.isNew()) {
      context.isNew = true;
    }
    if (order.dirty('deletedAt') && order.get('deletedAt')) {
      context.isDeleted = true;
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
};

const afterFind = async (request: Parse.Cloud.AfterFindRequest<Order>) => {
  const orders = request.objects;
  const user = request.user;
  if (user) {
    orders.forEach(order => updateStatusTransporter(order));
  }
};

export { beforeSave, afterSave, afterFind };
