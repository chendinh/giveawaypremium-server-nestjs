export interface PriceEstimateReq {
  weight: number;
  serviceLevel: string;
  from: {
    province: string;
    district: string;
    address: string;
  };
  to: {
    province: string;
    district: string;
    address: string;
  },
  value: number;
  transport: string;
}
export interface TransporterOption {

}

export interface OrderReq {
  from: {
    province: string;
    district: string;
    address: string;
    name: string;
    ward: string;
    phone: string;
    street?: string;
  };
  to: {
    province: string;
    district: string;
    address:string;
    name: string;
    ward: string;
    phone: string;
    street?: string;
  },
  orderRequest?: any;
  orderId: string;
  value: number;
  serviceLevel: string;
  note?: string;
  codMoney?: number;
  isFreeShipping?: boolean;
  items: {
    name: string;
    weight: number;
    quantity: number;
  }[]
}

export interface Transporter {
  getPriceEstimate(PriceEstimateReq): Promise<number>
  createOrder(OrderReq): Promise<{}>
}
