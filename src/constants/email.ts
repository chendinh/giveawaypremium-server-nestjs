import * as path from 'path';

export enum EMAIL_TYPES {
  CONSIGNMENT = 'CONSIGNMENT',
  PAYMENT = 'PAYMENT',
}

// __dirname khi chạy từ dist/ sẽ là dist/constants/
// → join ../templates/email/ = dist/templates/email/ ✓
export const EMAIL_PATHS: { [key: string]: string } = {
  [EMAIL_TYPES.CONSIGNMENT]: path.join(
    __dirname,
    '../templates/email/consignment.ejs'
  ),
  [EMAIL_TYPES.PAYMENT]: path.join(__dirname, '../templates/email/payment.ejs'),
};
