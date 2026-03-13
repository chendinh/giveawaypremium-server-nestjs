import { CategoryResponse, NhanhServiceOptions } from "./interface";
import { NhanhServiceImpl } from "./nhanh.service";

interface NhanhCategory {
  findAll(): Promise<CategoryResponse[]>;
}

export class NhanhCategoryService extends NhanhServiceImpl implements NhanhCategory {
  static categoriessUrl = '/api/product/category';
  constructor(options: NhanhServiceOptions) {
    super(options);
  }

  public async findAll(): Promise<CategoryResponse[]> {
    try {
      const result = await this.request<CategoryResponse[]>(
        NhanhCategoryService.categoriessUrl, 
        'productcategory',
      );

      return result.data;
    } catch (error) {
      throw error;
    }
  }
};
