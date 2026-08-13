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

  // #8 Performance: chỉ sync khi các field liên quan đến số liệu thay đổi
  // Tránh sync khi save media, note, hay field không ảnh hưởng aggregate
  const isNew = request.context?.isNew;
  const hasDirtyStockField = STOCK_DIRTY_FIELDS.some(f => product.dirty(f));
  if (!isNew && !hasDirtyStockField) return;

  const query = new Parse.Query(Consignment);
  const consignmentId = consignmentPointer.id;
  if (!consignmentId) return;

  const consignment = await query
    .equalTo('objectId', consignmentId)
    .greaterThan('createdAt', new Date('2022-08-04T15:04:06.196Z'))
    .first();

  if (!consignment) {
    return;
  }

  const prodQuery = new Parse.Query(Product);
  const products = await prodQuery
    .equalTo('consignment', consignmentPointer)
    .doesNotExist('deletedAt')
    .find();
  const productList = products.map(product => {
    const productJson = product.toJSON();
    return {
      ...productJson,
      subCategoryId: product.get('subCategory')?.id ?? null,
      categoryId: product.get('category')?.id ?? null,
    };
  });
  const soldNumberProducts = products.map(
    product => product.get('soldNumberProduct') ?? 0
  );
  const numSoldConsignment = sum(soldNumberProducts);
  const remainNumberProducts = products.map(
    product => product.get('remainNumberProduct') ?? 0
  );
  const remainNumConsignment = sum(remainNumberProducts);
  const counts = products.map(product => product.get('count') ?? 0);
  const numberOfPoducts = sum(counts);
  const moneyBackForFullSolds = products.map(product => {
    const productPrice = product.get('price') ?? 0;
    const count = product.get('count') ?? 0;
    let moneyBackSold = productPrice;

    if (productPrice > 0) {
      if (productPrice < 1000) {
        moneyBackSold = (productPrice * 74) / 100;
      } else if (productPrice >= 1000 && productPrice <= 10000) {
        moneyBackSold = (productPrice * 77) / 100;
      } else if (productPrice > 10000) {
        moneyBackSold = (productPrice * 80) / 100;
      }
    }
    return moneyBackSold * count;
  });
  const moneyBackForFullSold = sum(moneyBackForFullSolds);
  const totalMoneys = products.map(product => {
    const productPrice = product.get('price') ?? 0;
    const count = product.get('count') ?? 0;

    return productPrice * count;
  });
  const totalMoney = sum(totalMoneys);
  const moneyBackProduct = products.map(product => {
    const productPrice = product.get('price') ?? 0;
    const soldNumberProduct = product.get('soldNumberProduct') ?? 0;
    let moneyBackSold = productPrice;

    if (productPrice > 0) {
      if (productPrice < 1000) {
        moneyBackSold = (productPrice * 74) / 100;
      } else if (productPrice >= 1000 && productPrice <= 10000) {
        moneyBackSold = (productPrice * 77) / 100;
      } else if (productPrice > 10000) {
        moneyBackSold = (productPrice * 80) / 100;
      }
    }
    return moneyBackSold * soldNumberProduct;
  });
  const moneyBack = sum(moneyBackProduct);
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
