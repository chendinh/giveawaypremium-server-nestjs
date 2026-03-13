import { Category } from '../../models/category';
import { SubCategory } from '../../models/sub.category';

const afterCreate = async (request: Parse.Cloud.AfterSaveRequest<SubCategory>) => {
  const subCategory = request.object;
  const category: Category = await subCategory.get('category').fetch();

  const query = new Parse.Query(SubCategory);
  const subCategories: SubCategory[] = await query.equalTo('category', category).findAll();
  category.save({
    subCategories: subCategories
  }, { useMasterKey: true });
}



const beforeSave = async (request: Parse.Cloud.BeforeSaveRequest) => {
  try {
    const consignment = request.object;
    if (consignment.isNew()) {
      request.context = { isNew: true };
    } 
  } catch (error) {
    throw error;
  }
};

const afterSave = async (request: Parse.Cloud.AfterSaveRequest) => {
  if (request.context.isNew) afterCreate(request);
};

export {
  beforeSave,
  afterSave
};
