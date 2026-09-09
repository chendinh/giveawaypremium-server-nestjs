import { Consignment } from '../../models/consignment';
import { Media } from '../../models/media';
import { Product, ProductStatusEnums } from '../../models/product';
import sum = require('lodash/sum');

const STOCK_DIRTY_FIELDS = [
  'soldNumberProduct',
  'remainNumberProduct',
  'count',
  'price',
  'priceAfterFee',
  'deletedAt',
];

const syncConsignment = async (
  request: Parse.Cloud.AfterSaveRequest<Product>
) => {
  const product = request.object;
  const consignmentPointer = product.get('consignment');
  // Guard: Product không có consignment thì skip
  if (!consignmentPointer) return;

  // Chỉ sync khi các field liên quan đến số liệu thay đổi
  // Tránh sync khi save media, note, hay field không ảnh hưởng aggregate
  const isNew = request.context?.isNew;
  const original = request.original;

  let hasDirtyStockField: boolean;
  if (original) {
    hasDirtyStockField = STOCK_DIRTY_FIELDS.some(f => {
      const before = original.get(f);
      const after = product.get(f);
      return JSON.stringify(before) !== JSON.stringify(after);
    });
  } else {
    // original undefined khi trigger từ server-side Cloud Code (prod.save() trong Order.afterCreate)
    // — sync luôn cho an toàn
    hasDirtyStockField = true;
  }

  if (!isNew && !hasDirtyStockField) return;

  const consignmentId = consignmentPointer.id;
  if (!consignmentId) return;

  // Fetch consignment trực tiếp bằng objectId — không cần filter date thừa
  const consignment = await new Parse.Query(Consignment)
    .get(consignmentId, {
      useMasterKey: true,
    })
    .catch(() => null);

  if (!consignment) {
    console.warn(
      `[Product syncConsignment] Consignment ${consignmentId} not found — skip sync`
    );
    return;
  }

  const prodQuery = new Parse.Query(Product);
  const products = await prodQuery
    .equalTo('consignment', consignmentPointer)
    .doesNotExist('deletedAt')
    .find({ useMasterKey: true });

  const productList = products.map(p => {
    const productJson = p.toJSON();
    return {
      ...productJson,
      subCategoryId: p.get('subCategory')?.id ?? null,
      categoryId: p.get('category')?.id ?? null,
    };
  });

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
      const count = p.get('count') ?? 0;
      let rate = price < 1000 ? 0.74 : price <= 10000 ? 0.77 : 0.8;
      return price > 0 ? price * rate * count : 0;
    })
  );

  const totalMoney = sum(
    products.map(p => (p.get('price') ?? 0) * (p.get('count') ?? 0))
  );

  const moneyBack = sum(
    products.map(p => {
      const price = p.get('price') ?? 0;
      const sold = p.get('soldNumberProduct') ?? 0;
      let rate = price < 1000 ? 0.74 : price <= 10000 ? 0.77 : 0.8;
      return price > 0 ? price * rate * sold : 0;
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

const afterUpdate = async (
  request: Parse.Cloud.AfterSaveRequest<Product>
) => {};

const beforeCreate = async (
  request: Parse.Cloud.BeforeSaveRequest<Product>
) => {
  const product = request.object;
  product.set('status', ProductStatusEnums.NEW);
  product.set('soldNumberProduct', 0);
};

const handleProductMedias = async (
  request: Parse.Cloud.BeforeSaveRequest<Product>
) => {
  const product = request.object;
  const medias = (product.get('medias') as Media[]) || [];
  medias.forEach(media => {
    media.save({ isDraft: false }, { useMasterKey: true });
  });
};

const beforeSave = async (request: Parse.Cloud.BeforeSaveRequest<Product>) => {
  const product = request.object;

  if (product.dirty('consignment') && !product.get('consignment')) {
    throw new Error('Invalid Consignment Pointer');
  }

  if (product.dirty('medias')) {
    request.context.dirtyMedias = true;
  }

  if (product.isNew()) {
    beforeCreate(request);
    request.context.isNew = true;
  }
};

const afterSave = async (request: Parse.Cloud.AfterSaveRequest<Product>) => {
  try {
    const context = request.context;
    // Await để catch error nếu sync thất bại
    await syncConsignment(request).catch(err =>
      console.error(
        '[Product afterSave] syncConsignment failed:',
        err?.message || err
      )
    );
    if (context.isNew) {
      // afterCreate(request);
    } else {
      afterUpdate(request);
    }
    if (context.dirtyMedias) {
      handleProductMedias(request);
    }
  } catch (err) {
    // Không để uncaughtException crash server
    console.error('[Product afterSave] error:', err?.message || err);
  }
};

export { beforeSave, afterSave };
