/**
 * Cloud Function: getOrderSummary
 *
 * Aggregate dữ liệu Order trực tiếp trên server thay vì kéo raw data về FE.
 * Tránh lỗi 500 do limit quá lớn (100000) và giảm tải network.
 *
 * Quyền: requireUser — chỉ admin mới gọi được.
 */

interface OrderSummaryParams {
  fromDate: string; // ISO string, e.g. "2026-08-01T00:00:00.000Z"
  toDate: string; // ISO string, e.g. "2026-08-31T23:59:59.999Z"
}

interface OrderSummaryResult {
  totalOrder: number;
  totalProduct: number;
  moneyForSale: number;
  moneyAfterFee: number;
  moneyFromFee: number;
  transferBankMoneyAmount: number;
  transferOfflineMoneyAmount: number;
  numberOnlineSale: number;
  numberOfflineSale: number;
  moneyForOnlineSale: number;
  moneyForOfflineSale: number;
}

export const getOrderSummary = async (
  request: Parse.Cloud.FunctionRequest<OrderSummaryParams>
): Promise<OrderSummaryResult> => {
  const { fromDate, toDate } = request.params;

  if (!fromDate || !toDate) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      'fromDate and toDate are required'
    );
  }

  const from = new Date(fromDate);
  const to = new Date(toDate);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Invalid date format');
  }

  if (from > to) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      'fromDate must be before toDate'
    );
  }

  // Query tất cả orders trong khoảng thời gian, không include nested objects
  // Chỉ lấy các fields cần cho summary — không include client/productList
  // findAll() không cho dùng limit/skip/sort nên KHÔNG set những thứ đó
  const query = new Parse.Query('Order');
  query.doesNotExist('deletedAt');
  query.greaterThanOrEqualTo('createdAt', from);
  query.lessThanOrEqualTo('createdAt', to);
  query.select([
    'totalMoneyForSale',
    'totalMoneyForSaleAfterFee',
    'totalNumberOfProductForSale',
    'isOnlineSale',
    'transferBankMoneyAmount',
    'transferOfflineMoneyAmount',
    // Lấy transporter pointer để detect đơn VTP/GHTK bị thiếu flag isOnlineSale
    'transporter',
  ]);

  const orders = await query.findAll({ useMasterKey: true });

  let totalProduct = 0;
  let moneyForSale = 0;
  let moneyAfterFee = 0;
  let transferBankMoneyAmount = 0;
  let transferOfflineMoneyAmount = 0;
  let numberOnlineSale = 0;
  let numberOfflineSale = 0;
  let moneyForOnlineSale = 0;
  let moneyForOfflineSale = 0;

  for (const order of orders) {
    const total = Number(order.get('totalMoneyForSale')) || 0;
    const totalAfterFee = Number(order.get('totalMoneyForSaleAfterFee')) || 0;
    const productCount = Number(order.get('totalNumberOfProductForSale')) || 0;
    // Đơn có transporter (vận đơn VTP/GHTK) luôn được tính là online,
    // dù field isOnlineSale có thể bị thiếu/sai ở đơn cũ
    const hasTransporter = !!order.get('transporter');
    const isOnline = hasTransporter || Boolean(order.get('isOnlineSale'));

    const bankAmt = Number(order.get('transferBankMoneyAmount'));
    const offlineAmt = Number(order.get('transferOfflineMoneyAmount'));

    moneyForSale += total;
    moneyAfterFee +=
      totalAfterFee > 0 ? totalAfterFee : convertPriceAfterFee(total);
    totalProduct += productCount;
    transferBankMoneyAmount += isNaN(bankAmt) ? 0 : bankAmt;
    transferOfflineMoneyAmount += isNaN(offlineAmt) ? 0 : offlineAmt;

    if (isOnline) {
      numberOnlineSale += 1;
      moneyForOnlineSale += total;
    } else {
      numberOfflineSale += 1;
      moneyForOfflineSale += total;
    }
  }

  const moneyFromFee = moneyForSale - moneyAfterFee;

  return {
    totalOrder: orders.length,
    totalProduct,
    moneyForSale: Math.round(moneyForSale),
    moneyAfterFee: Math.round(moneyAfterFee),
    moneyFromFee: Math.round(moneyFromFee),
    transferBankMoneyAmount: Math.round(transferBankMoneyAmount),
    transferOfflineMoneyAmount: Math.round(transferOfflineMoneyAmount),
    numberOnlineSale,
    numberOfflineSale,
    moneyForOnlineSale: Math.round(moneyForOnlineSale),
    moneyForOfflineSale: Math.round(moneyForOfflineSale),
  };
};

// ─── Helpers (mirror logic từ FE để tính nhất quán) ──────────────────────────
function convertPriceAfterFee(productPrice: number): number {
  if (productPrice <= 0) return 0;
  if (productPrice < 1000) return (productPrice * 74) / 100;
  if (productPrice <= 10000) return (productPrice * 77) / 100;
  return (productPrice * 80) / 100;
}
