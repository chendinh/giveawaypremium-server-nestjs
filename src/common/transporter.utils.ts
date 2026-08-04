import {
  GHTKSTATUS,
  VIETTELPOST_STATUS,
  VTP_FINAL_STATUSES,
  VTP_CANCELLABLE_STATUSES,
} from '../constants/order-status';

export const getStatusByService = (
  service: string,
  statusCode: number | string
): string => {
  const code = statusCode.toString();
  switch (service) {
    case 'giaohangtietkiem':
      return GHTKSTATUS[code] ?? '';
    case 'viettelpost':
      return VIETTELPOST_STATUS[code] ?? '';
    default:
      return '';
  }
};

export const getTransporterOrderId = (service: string, res: any): string => {
  switch (service) {
    case 'giaohangtietkiem':
      return res?.order?.label_id ?? '';
    case 'viettelpost':
      // res là ViettelPostApiResponse<ViettelPostCreateOrderData>
      return res?.data?.ORDER_NUMBER ?? '';
    default:
      return '';
  }
};

/**
 * Lấy status code từ response.
 * ViettelPost: status đến từ webhook (ViettelPostWebhookData.ORDER_STATUS)
 */
export const getStatusFromResponse = (
  service: string,
  response: any
): number => {
  switch (service) {
    case 'giaohangtietkiem':
      return response?.order?.status ?? 0;
    case 'viettelpost':
      // Từ webhook payload: response.DATA.ORDER_STATUS
      // Từ cancelOrder: response.status=200, data=null → trả về 107 (Đối tác hủy)
      if (response?.status === 200 && response?.data === null) {
        return 107;
      }
      return response?.DATA?.ORDER_STATUS ?? response?.data?.ORDER_STATUS ?? 0;
    default:
      return 0;
  }
};

/**
 * Kiểm tra đơn VTP có ở trạng thái CUỐI không
 * (không phát sinh thêm trạng thái, dừng cập nhật hành trình)
 * Ref: Tài liệu VTP — mục Webhook
 */
export const isVtpFinalStatus = (statusCode: number): boolean => {
  return VTP_FINAL_STATUSES.has(statusCode);
};

/**
 * Kiểm tra đơn VTP có thể HỦY không
 * Điều kiện: status IN (102, 103, 104) — chưa được bưu tá nhận
 */
export const isVtpCancellable = (statusCode: number): boolean => {
  return VTP_CANCELLABLE_STATUSES.has(statusCode);
};
