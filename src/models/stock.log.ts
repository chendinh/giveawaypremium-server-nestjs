/**
 * StockLog — audit trail cho mọi thay đổi stock của Product.
 *
 * Fields:
 *   product      Pointer<Product>   — product bị thay đổi
 *   orderId      string             — Parse objectId của Order liên quan
 *   delta        number             — thay đổi remainNumberProduct (+/-), ví dụ -1 hoặc +1
 *   reason       StockLogReason     — lý do thay đổi
 *   snapshot     object             — { remainBefore, remainAfter, soldBefore, soldAfter }
 *   createdAt    Date               — tự động bởi Parse
 */
export enum StockLogReason {
  ORDER_CREATED = 'ORDER_CREATED', // Tạo đơn hàng → giảm stock
  ORDER_DELETED = 'ORDER_DELETED', // Xóa mềm đơn hàng → hoàn stock
  MANUAL_ADJUST = 'MANUAL_ADJUST', // Admin chỉnh tay
}

export class StockLog extends Parse.Object {
  constructor() {
    super('StockLog');
  }
}

Parse.Object.registerSubclass('StockLog', StockLog);
