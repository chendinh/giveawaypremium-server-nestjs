import {
  getStatusByService,
  getTransporterOrderId,
  getStatusFromResponse,
} from '../../common/transporter.utils';
import { OrderRequestStatus } from '../../constants/order-status';
import { getOrder, cancelOrder } from '../../external-services/transporter';
import { Consignment } from '../../models/consignment';
import { Order } from '../../models/order';
import { OrderRequest } from '../../models/order.request';
import { Product } from '../../models/product';
import { StockLog, StockLogReason } from '../../models/stock.log';
import { Transporter } from '../../models/transporter';
import { updateOrderRequestQueue } from '../order-request';
import sum = require('lodash/sum');

/**
 * Sync aggregate fields của Consignment từ tất cả Products của nó.
 * Gọi sau khi TẤT CẢ product saves hoàn thành để tránh race condition.
 */
const syncConsignmentById = async (consignmentId: string): Promise<void> => {
  try {
    const consignment = await new Parse.Query(Consignment).get(consignmentId, {
      useMasterKey: true,
    });

    const consignmentPointer = new Consignment();
    consignmentPointer.id = consignmentId;

    const products = await new Parse.Query(Product)
      .equalTo('consignment', consignmentPointer)
      .doesNotExist('deletedAt')
      .find({ useMasterKey: true });

    const productList = products.map(p => ({
      ...p.toJSON(),
      subCategoryId: p.get('subCategory')?.id ?? null,
      categoryId: p.get('category')?.id ?? null,
    }));

    const numSoldConsignment = sum(
      products.map(p => p.get('soldNumberProduct') ?? 0)
    );
    const remainNumConsignment = sum(
      products.map(p => p.get('remainNumberProduct') ?? 0)
    );
    const numberOfPoducts = sum(products.map(p => p.get('count') ?? 0));

    const getRate = (price: number) =>
      price <= 0 ? 0 : price < 1000 ? 0.74 : price <= 10000 ? 0.77 : 0.8;

    const moneyBackForFullSold = sum(
      products.map(p => {
        const price = p.get('price') ?? 0;
        return price * getRate(price) * (p.get('count') ?? 0);
      })
    );
    const totalMoney = sum(
      products.map(p => (p.get('price') ?? 0) * (p.get('count') ?? 0))
    );
    const moneyBack = sum(
      products.map(p => {
        const price = p.get('price') ?? 0;
        return price * getRate(price) * (p.get('soldNumberProduct') ?? 0);
      })
    );

    await consignment.save(
      {
        productList,
        numSoldConsignment,
        remainNumConsignment,
        numberOfPoducts,
        moneyBackForFullSold,
        totalMoney,
        moneyBack,
      },
      { useMasterKey: true }
    );
  } catch (err) {
    console.error(
      `[Order syncConsignmentById] consignment ${consignmentId} failed:`,
      (err as any)?.message || err
    );
  }
};

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

    // Pre-collect consignmentId từ plain data — không phụ thuộc fetch thành công
    // Note: getProductWithCode không include 'consignment' nên plain data thường không có,
    // nhưng để đây phòng trường hợp future có include.
    const consignmentIdsToSync = new Set<string>();
    productList.forEach((item: any) => {
      const cid = item?.consignment?.objectId || item?.consignmentId;
      if (cid) consignmentIdsToSync.add(cid);
    });

    // Fallback: query consignment trực tiếp từ DB cho các product có objectId
    // Chạy trước, song song với việc trừ stock — để đảm bảo consignmentId luôn có
    // dù fetch product trong vòng lặp bên dưới có fail
    const collectConsignmentIds = productList
      .filter((item: any) => item?.objectId)
      .map(async (item: any) => {
        try {
          const p = await new Parse.Query(Product)
            .select('consignment')
            .get(item.objectId, { useMasterKey: true });
          const cid = p.get('consignment')?.id;
          if (cid) consignmentIdsToSync.add(cid);
        } catch {
          // không tìm thấy — skip, không block
        }
      });
    // Không await ở đây — chạy song song với stock update, kết quả được dùng sau Promise.all

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

          // Collect thêm từ DB record (chắc chắn nhất)
          const consignmentId = prod.get('consignment')?.id;
          if (consignmentId) consignmentIdsToSync.add(consignmentId);

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
          // Product không tìm thấy — log nhưng không crash toàn bộ flow
          console.error(
            `[Order afterCreate] Product ${product.objectId} not found:`,
            err?.message || err
          );
          return null;
        }
      });
    await Promise.all(promise);
    // Đợi cả collectConsignmentIds hoàn thành để đảm bảo Set đầy đủ
    await Promise.all(collectConsignmentIds);

    // Sau khi TẤT CẢ products đã save xong mới sync aggregate consignment.
    // consignmentIdsToSync đã được collect cả từ plain data lẫn DB fetch
    // nên vẫn sync dù một vài product fetch thất bại.
    if (consignmentIdsToSync.size > 0) {
      await Promise.all(
        [...consignmentIdsToSync].map(cid => syncConsignmentById(cid))
      );
    }

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

  // Pre-collect consignmentId từ plain data — không phụ thuộc fetch thành công
  const consignmentIdsToSync = new Set<string>();
  productList.forEach((item: any) => {
    const cid = item?.consignment?.objectId || item?.consignmentId;
    if (cid) consignmentIdsToSync.add(cid);
  });

  // Fallback: query trực tiếp từ DB song song với việc hoàn stock
  const collectConsignmentIds = productList
    .filter((item: any) => item?.objectId)
    .map(async (item: any) => {
      try {
        const p = await new Parse.Query(Product)
          .select('consignment')
          .get(item.objectId, { useMasterKey: true });
        const cid = p.get('consignment')?.id;
        if (cid) consignmentIdsToSync.add(cid);
      } catch {
        // không tìm thấy — skip
      }
    });

  const promise = productList
    .filter((product: any) => product?.objectId)
    .map(async (product: any) => {
      const productPointer = new Product();
      productPointer.id = product.objectId;

      try {
        const prod = await productPointer.fetch({ useMasterKey: true });
        const remainBefore = prod.get('remainNumberProduct') ?? 0;
        const soldBefore = prod.get('soldNumberProduct') ?? 0;

        prod.decrement('soldNumberProduct', product.count);
        prod.increment('remainNumberProduct', product.count);
        await prod.save(undefined, { useMasterKey: true });

        // Collect thêm từ DB record
        const consignmentId = prod.get('consignment')?.id;
        if (consignmentId) consignmentIdsToSync.add(consignmentId);

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
  await Promise.all(collectConsignmentIds);

  // Sync consignment sau khi hoàn stock toàn bộ
  if (consignmentIdsToSync.size > 0) {
    await Promise.all(
      [...consignmentIdsToSync].map(cid => syncConsignmentById(cid))
    );
  }

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

  // Await để đảm bảo stock được trừ trước khi afterSave kết thúc.
  // Fire-and-forget trước đây là bug: lỗi bên trong afterCreate bị nuốt im lặng.
  if (context.isNew) await afterCreate(request);
  if (context.isDeleted) await afterDelete(request);
};

const afterFind = async (request: Parse.Cloud.AfterFindRequest<Order>) => {
  const orders = request.objects;
  const user = request.user;
  if (user) {
    orders.forEach(order => updateStatusTransporter(order));
  }
};

export { beforeSave, afterSave, afterFind };
