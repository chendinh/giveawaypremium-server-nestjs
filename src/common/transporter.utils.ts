import { GHTKSTATUS, VIETTELPOST_STATUS } from '../constants/order-status';

export const getStatusByService = (service: string, statusCode: number | string): string => {
  const code = statusCode.toString();
  switch (service) {
    case 'giaohangtietkiem':
      return GHTKSTATUS[code] ?? '';
    case 'viettelpost':
      return VIETTELPOST_STATUS[code] ?? '';
    default:
      return '';
  }
}

export const getTransporterOrderId = (service: string, res: any): string => {
  switch (service) {
    case 'giaohangtietkiem':
      return res.order?.label_id ?? '';
    case 'viettelpost':
      return res.data?.ORDER_NUMBER ?? '';
    default:
      return '';
  }
}

export const getStatusFromResponse = (service: string, response: any): number => {
  switch (service) {
    case 'giaohangtietkiem':
      return response?.order?.status ?? 0;
    case 'viettelpost':
      return response?.data?.ORDER_STATUS ?? response?.status ?? 0;
    default:
      return 0;
  }
}
