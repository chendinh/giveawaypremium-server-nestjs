import { CreateOrUpdateProductResponse, NhanhServiceOptions, NhanhProductDetail, findProducParams, FindProductRes } from "./interface";
import { NhanhServiceImpl } from "./nhanh.service";

interface NhanhProduct {
  create(products: NhanhProductDetail[]): Promise<CreateOrUpdateProductResponse>;
  findByNhanhId(nhanhId: string): Promise<NhanhProductDetail>;
  find(params: findProducParams): Promise<FindProductRes>;
  update(products: NhanhProductDetail[]): Promise<CreateOrUpdateProductResponse>
}

export class NhanhProductService extends NhanhServiceImpl implements NhanhProduct {
  static productCreateUrl = '/api/product/add';
  static productDetailUrl = '/api/product/detail';
  static productsUrl = '/api/product/search';
  constructor(options: NhanhServiceOptions) {
    super(options);
  }

  public async create(products: NhanhProductDetail[]): Promise<CreateOrUpdateProductResponse> {
    try {
      const result = await this.request<CreateOrUpdateProductResponse>(
        NhanhProductService.productCreateUrl, 
        products,
      );
      return result.data;
    } catch (error) {
      throw error;
    }
  }

  public async findByNhanhId(nhanhId: string): Promise<NhanhProductDetail> {
    try {
      const result = await this.request<{[id: string]: NhanhProductDetail}>(
        NhanhProductService.productDetailUrl, 
        nhanhId,
      );

      return result.data[nhanhId];
    } catch (error) {
      throw error;
    }
  }

  public async find(params: findProducParams): Promise<FindProductRes> {
    try {
      const result = await this.request<FindProductRes>(
        NhanhProductService.productsUrl, 
        params,
      );

      return result.data;
    } catch (error) {
      throw error;
    }
  }

  public async update(products: NhanhProductDetail[]): Promise<CreateOrUpdateProductResponse> {
    try {
      const result = await this.request<CreateOrUpdateProductResponse>(
        NhanhProductService.productCreateUrl, 
        products,
      );
      return result.data;
    } catch (error) {
      throw error;
    }
  }
}
