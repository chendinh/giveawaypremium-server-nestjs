import { Category } from '../../models/category';
import { Consignment } from '../../models/consignment';
import { Product } from '../../models/product';
import { SubCategory } from '../../models/sub.category';


const afterCreate = async (request: Parse.Cloud.AfterSaveRequest<Consignment>) => {
  const consignment = request.object;
  const rawProducts = consignment.get('productList');
  
  const promises = rawProducts.map(async (rawProduct) => {
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
      moneyBackProduct: rawProduct.moneyBackProduct,
      consignment: consignment,
      consignee: consignment.get('consignee'),
      consigner: consignment.get('consigner'),
      group: consignment.get('group'),
      category: pointerCategory,
      subCategory: rawProduct.subCategoryId ? pointerSubCategory : undefined,
      rateNew: rawProduct.rateNew,
    }
    const product = new Product();

    return product.save(data, { useMasterKey: true });
  
  })
  
  await Promise.all(promises);
}

const afterDelete = async (request: Parse.Cloud.AfterSaveRequest<Consignment>) => {
  const consignmentPointer = request.object;
  const prodQuery = new Parse.Query(Product);
  const products = await prodQuery.equalTo('consignment', consignmentPointer).find();
  Parse.Object.saveAll(products.map((product) => { product.set('deletedAt', new Date()); return product; }))
}

const beforeSave = async (request: Parse.Cloud.BeforeSaveRequest) => {
  try {
    const consignment = request.object;

    if (consignment.isNew()) {
      request.context.isNew =true;
    } 
    if (consignment.dirty('deletedAt') && consignment.get('deletedAt')) {
      request.context.isDeleted = true
    }
   
  } catch (error) {
    throw error;
  }
};

const afterSave = async (request: Parse.Cloud.AfterSaveRequest<Consignment>) => {
  if (request.context.isNew) afterCreate(request);
  if (request.context.isDeleted) afterDelete(request);
}


export {
  beforeSave,
  afterSave
};
