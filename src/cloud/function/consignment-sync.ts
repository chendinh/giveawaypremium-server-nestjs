import { Consignment } from '../../models/consignment';
import { Product } from '../../models/product';
import sum = require('lodash/sum');

/**
 * Re-sync aggregate fields (remainNumConsignment, numSoldConsignment, numberOfProducts, ...)
 * cho một hoặc nhiều Consignment từ Products thực tế trong DB.
 *
 * Dùng để sửa data cũ bị stale do race condition giữa product.afterSave
 * và order.afterSave cùng ghi consignment đồng thời.
 *
 * Params:
 *   - consignmentId (string): objectId của một Consignment cụ thể
 *   - groupId (string): objectId của ConsignmentGroup — sync toàn bộ đợt
 * Phải truyền ít nhất 1 trong 2.
 *
 * Yêu cầu: master key (admin only).
 */
export const syncConsignmentStock = async (
  request: Parse.Cloud.FunctionRequest
): Promise<{ synced: number; errors: number }> => {
  const { consignmentId, groupId } = request.params as {
    consignmentId?: string;
    groupId?: string;
  };

  let consignments: Consignment[] = [];

  if (consignmentId) {
    const c = await new Parse.Query(Consignment).get(consignmentId, {
      useMasterKey: true,
    });
    consignments = [c];
  } else if (groupId) {
    const groupPointer = new Parse.Object('ConsignmentGroup');
    groupPointer.id = groupId;
    consignments = await new Parse.Query(Consignment)
      .equalTo('group', groupPointer)
      .doesNotExist('deletedAt')
      .limit(1000)
      .find({ useMasterKey: true });
  }

  if (consignments.length === 0) {
    return { synced: 0, errors: 0 };
  }

  let synced = 0;
  let errors = 0;

  const getRate = (price: number) =>
    price <= 0 ? 0 : price < 1000 ? 0.74 : price <= 10000 ? 0.77 : 0.8;

  const syncOne = async (consignment: Consignment): Promise<void> => {
    const consignmentPointer = new Consignment();
    consignmentPointer.id = consignment.id;

    const products = await new Parse.Query(Product)
      .equalTo('consignment', consignmentPointer)
      .doesNotExist('deletedAt')
      .limit(500)
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
  };

  // Chạy song song theo batch 10 để không overload DB
  const BATCH = 10;
  for (let i = 0; i < consignments.length; i += BATCH) {
    const batch = consignments.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(c => syncOne(c)));
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        synced++;
      } else {
        console.error(
          `[syncConsignmentStock] consignment ${batch[idx].id} failed:`,
          r.reason?.message || r.reason
        );
        errors++;
      }
    });
  }

  return { synced, errors };
};
