import { Category } from '../../models/category';
import { Consignment } from '../../models/consignment';
import { Product } from '../../models/product';
import { SubCategory } from '../../models/sub.category';
import { sendConfirmationEmail } from '../function/mail';

const afterCreate = async (
  request: Parse.Cloud.AfterSaveRequest<Consignment>
) => {
  const consignment = request.object;
  const rawProducts = consignment.get('productList');

  const promises = rawProducts.map(async rawProduct => {
    const pointerCategory = new Category();
    pointerCategory.id = rawProduct.categoryId;
    const pointerSubCategory = new SubCategory();
    pointerSubCategory.id = rawProduct.subCategoryId;

    const data = {
      key: rawProduct.key,
      price: rawProduct.price,
      count: rawProduct.count,
      name: rawProduct.name,
      note: rawProduct.note,
      code: rawProduct.code,
      priceAfterFee: rawProduct.priceAfterFee,
      remainNumberProduct: rawProduct.count,
      soldNumberProduct: 0, // explicit init — tránh null khi sync consignment
      moneyBackProduct: rawProduct.moneyBackProduct,
      consignment: consignment,
      consignee: consignment.get('consignee'),
      consigner: consignment.get('consigner'),
      group: consignment.get('group'),
      category: pointerCategory,
      subCategory: rawProduct.subCategoryId ? pointerSubCategory : undefined,
      rateNew: rawProduct.rateNew,
    };
    const product = new Product();

    return product.save(data, { useMasterKey: true });
  });

  await Promise.all(promises);

  // Gửi email xác nhận ký gửi — fire-and-forget
  sendConfirmationEmail(consignment);
};

const afterDelete = async (
  request: Parse.Cloud.AfterSaveRequest<Consignment>
) => {
  const consignmentPointer = request.object;
  const prodQuery = new Parse.Query(Product);
  // Chỉ soft-delete các products chưa bị xóa
  const products = await prodQuery
    .equalTo('consignment', consignmentPointer)
    .doesNotExist('deletedAt')
    .find();
  if (!products.length) return;
  try {
    await Parse.Object.saveAll(
      products.map(product => {
        product.set('deletedAt', new Date());
        return product;
      }),
      { useMasterKey: true }
    );
  } catch (err) {
    console.error(
      '[Consignment afterDelete] saveAll failed:',
      err?.message || err
    );
  }
};

const beforeSave = async (request: Parse.Cloud.BeforeSaveRequest) => {
  try {
    const consignment = request.object;

    if (consignment.isNew()) {
      request.context.isNew = true;
    }
    if (consignment.dirty('deletedAt') && consignment.get('deletedAt')) {
      request.context.isDeleted = true;
    }
  } catch (error) {
    throw error;
  }
};

const afterSave = async (
  request: Parse.Cloud.AfterSaveRequest<Consignment>
) => {
  if (request.context.isNew) afterCreate(request);
  if (request.context.isDeleted) afterDelete(request);
};

export { beforeSave, afterSave };
