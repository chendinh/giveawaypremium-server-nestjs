export enum EMAIL_TYPES {
  CONSIGNMENT = 'CONSIGNMENT',
  PAYMENT = 'PAYMENT',
}

export const EMAIL_PATHS: { [key: string]: string } = {
  [EMAIL_TYPES.CONSIGNMENT]: './templates/email/consignment.ejs',
  [EMAIL_TYPES.PAYMENT]: './templates/email/payment.ejs',
};
