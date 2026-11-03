/**
 * Hình thức lấy hàng của đơn online — lưu ở `Order.shippingInfo.pickupType`
 * (client SaleScreen set khi tạo đơn).
 *
 * - SHIPPER: shipper ViettelPost đến lấy tại shop rồi giao cho khách (mặc định)
 * - SELF: khách tự đến lấy tại shop → KHÔNG có vận đơn (không tạo Transporter),
 *   nhưng VẪN là đơn online (`Order.isOnlineSale = true`) nên vẫn tính vào
 *   thống kê Online ở getOrderSummary
 *
 * Dữ liệu cũ có thể là '2' (shipper) / '1' (shop gửi bưu cục) / undefined →
 * tất cả đều hiểu là SHIPPER. Chỉ SELF mới là trường hợp đặc biệt.
 */
export enum OrderPickupType {
  SHIPPER = 'shipper',
  SELF = 'self',
}
