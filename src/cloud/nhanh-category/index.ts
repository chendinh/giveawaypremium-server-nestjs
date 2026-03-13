import { CategoryResponse } from "../../external-services/nhanh/interface";
import { NhanhCategoryService } from "../../external-services/nhanh/nhanh.categories";
import { nhanhConfigs } from "../../config/nhanh.config";

const findAll = async (): Promise<CategoryResponse[]> => {
  const nhanhCategoryService = new NhanhCategoryService(nhanhConfigs);
  return nhanhCategoryService.findAll();
}

export {
  findAll,
};
