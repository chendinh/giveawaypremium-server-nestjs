export interface NhanhService {
  // request<T = any, R = NhanhResponse<T>>(
  //   requestUri: string, 
  //   data: string | Object,
  //   storeId: null | string
  // ): Promise<R>
};

export interface NhanhResponse<T = any> {
  code: 1 | 0;
  messages: {
    [errorCode: string]: string;
  },
  data: T
};

export interface NhanhServiceOptions {
  server: string;
  version: string;
  secretKey: string;
  apiUsername: string;
};

export interface NhanhProductDetail {
  id: string;
  idNhanh?: string;
  code?: string;
  barcode?: string;
  name: string;
  image?: string;
  images?: string[];
  shippingWeight?: string;
  vat?: string;
  price: string;
  importPrice?: string;
  wholesalePrice?: string;
  status: 'New' | 'Active' | 'Inactive' | 'OutOfStock',
  categoryId?: string;
};

export interface CreateOrUpdateProductResponse {
  ids: {
    [id: string]: string;
  };
  barcodes: {
    [id: string]: string;
  };
};

export interface findProducParams {
  page?: number;
  icpp?: number;
  sort?: {
    [key: string]: 'asc' | 'desc'
  };
  name?: string;
  parentId?: number;
  categoryId?: number;
  status?: string;
  priceFrom?: number;
  priceTo?: number;
  brandId?: number;
  imei?: string;
};

export interface FindProductRes {
  currentPage: number;
  totalPages: number;
  products: {
    [id: string]: NhanhProductDetail
  };
};

export interface CategoryResponse {
  id: string,
  parentId: string,
  name: string,
  code: string,
  order: string,
  showHome: string,
  showHomeOrder: string,
  privateId: string,
  image: string
};
