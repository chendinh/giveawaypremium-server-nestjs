export const viettelpostConfigs = {
  viettelpostUrl:
    process.env.VIETTELPOST_URL || 'https://partner.viettelpost.vn/v2',
  viettelpostToken: process.env.VIETTELPOST_TOKEN || '',
  viettelpostUsername: process.env.VIETTELPOST_USERNAME || '',
  viettelpostPassword: process.env.VIETTELPOST_PASSWORD || '',
  viettelpostWebhookSecret: process.env.VIETTELPOST_WEBHOOK_SECRET || '',
  /** ID kho lấy hàng đã đăng ký trên portal VTP (Pickup point Q1)
   *  Bắt buộc để shipper đến lấy tận nơi thay vì shop mang đến bưu cục */
  viettelpostGroupAddressId: Number(
    process.env.VIETTELPOST_GROUPADDRESS_ID || 7273384
  ),
};
