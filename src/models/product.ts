import { NhanhProductDetail } from '../external-services/nhanh/interface';

export enum ProductStatusEnums {
  NEW = 'NEW',
  AVAILABLE = 'AVAILABLE',
  ACTIVE = 'ACTIVE',
}

export interface ProductInventory {
  remain: number;
  available: number;
  offline: number;
  active: number;
  delivered: number;
  shipping: number;
}

export class Product extends Parse.Object {
  constructor() {
    super('Product');
  }

  public getNhanhProduct(): NhanhProductDetail {
    const data = this.get('nhanhProduct');
    return {
      id: this.id,
      ...data,
    };
  }
}

Parse.Object.registerSubclass('Product', Product);
