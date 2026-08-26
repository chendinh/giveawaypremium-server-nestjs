import moment from 'moment';
import * as ejs from 'ejs';
import { MailFactory } from '../../external-services/email';
import { MAIL_TYPE } from '../../external-services/email/constants';
import { mailConfigs } from '../../config/email.config';
import { EMAIL_PATHS, EMAIL_TYPES } from '../../constants/email';
import { Consignment } from '../../models/consignment';
import { ConsignmentGroup } from '../../models/consignment.group';
import { Email } from '../../models/email';

export interface ProductEmailItem {
  name: string;
  amount: number;
  status: string;
  price: number;
  priceAfterFee: number;
}

export interface ConsignmentEmailData {
  customerName: string;
  phoneNumber: string;
  identityId: string;
  consignmentId: string;
  numberOfProduct: number;
  bankName: string;
  bankId: string;
  timeGetMoney: string;
  timeCheck: string;
  products: ProductEmailItem[];
}

export interface PaymentEmailData {
  customerName: string;
  phoneNumber: string;
  identityId: string;
  consignmentId: string;
  numberOfProduct: number;
  bankName: string;
  bankId: string;
  moneyBack: string; // đã format: "1,000,000 vnd"
  note: string; // "---" nếu rỗng
}

interface RawProduct {
  key: string;
  name: string;
  price: number;
  count: number;
  priceAfterFee: number;
  rateNew: string;
  note?: string;
  code?: string;
  categoryId: string;
  subCategoryId?: string;
  moneyBackProduct?: number;
}

export function buildEmailData(consignment: Consignment): ConsignmentEmailData {
  const consigner = consignment.getConsigner();

  const customerName = (consigner?.get('name') as string) ?? '';
  const phoneNumber = (consigner?.get('phone') as string) ?? '';
  const identityId = (consigner?.get('identityId') as string) ?? '';
  const consignmentId = consignment.id;
  const bankName = (consignment.get('bankName') as string) ?? '';
  const bankId = (consignment.get('bankId') as string) ?? '';
  const timeGetMoney = (consignment.get('timeGetMoney') as string) ?? '';

  const timeCheck = timeGetMoney
    ? moment(timeGetMoney, 'DD-MM-YYYY')
        .subtract(3, 'days')
        .format('DD-MM-YYYY')
    : '';

  const productList: RawProduct[] = consignment.get('productList') ?? [];
  const numberOfProduct = productList.length;

  const products: ProductEmailItem[] = productList.map(rawProduct => ({
    name: rawProduct.name,
    amount: rawProduct.count,
    status: rawProduct.rateNew ?? '',
    price: rawProduct.price,
    priceAfterFee: rawProduct.priceAfterFee,
  }));

  return {
    customerName,
    phoneNumber,
    identityId,
    consignmentId,
    numberOfProduct,
    bankName,
    bankId,
    timeGetMoney,
    timeCheck,
    products,
  };
}

const emailFactory = MailFactory.getMail(MAIL_TYPE.SENDINBLUE, mailConfigs);

const getEmailTemplates = async (): Promise<Email[]> => {
  const query = new Parse.Query(Email);
  const emails = await query.find();
  return emails;
};

const reminderEmail = async (consignment: Consignment): Promise<string> => {
  const remainNumConsignment = consignment.get(
    'remainNumConsignment'
  ) as number;
  const isTransferMoneyWithBank = consignment.get(
    'isTransferMoneyWithBank'
  ) as boolean;
  const timeGetMoneyStr = consignment.get('timeGetMoney') as string;
  const timeGetMoney = moment(timeGetMoneyStr, 'DD-MM-YYYY')
    .subtract(3, 'days')
    .format('DD-MM-YYYY');
  const emails = await getEmailTemplates();
  let email: Email | undefined;

  switch (isTransferMoneyWithBank) {
    case false:
      if (remainNumConsignment === 0) {
        email = emails.find(el => el.get('key') === 'REMINDER1');
      } else {
        email = emails.find(el => el.get('key') === 'REMINDER2');
      }
      break;
    case true:
      if (remainNumConsignment === 0) {
        email = emails.find(el => el.get('key') === 'REMINDER3');
      } else {
        email = emails.find(el => el.get('key') === 'REMINDER4');
      }
      break;
    default:
      email = undefined;
      break;
  }

  if (!email) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      `Reminder Template Not Found.`
    );
  }

  const content = (email.get('content') as string) ?? '';

  return content
    .replace('{{remainNumConsignment}}', `${remainNumConsignment}`)
    .replace('{{timeGetMoney}}', `${timeGetMoney}`);
};

const remiderConsignment = async (consignment: Consignment): Promise<void> => {
  try {
    const consigner = consignment.getConsigner();
    const email =
      (consigner.get('email') as string) || (consigner.get('mail') as string);

    if (!email)
      throw new Parse.Error(
        Parse.Error.EMAIL_NOT_FOUND,
        `emai consigner ${consigner.id} not found`
      );

    const html = await reminderEmail(consignment);

    await emailFactory.send({
      mailTo: email,
      title: `Give Away Premium thông báo: đơn hàng ${consignment.id}`, // Subject line
      html,
    });

    return;
  } catch (error) {
    console.error(`[Error] remiderConsignment`, error);
    return;
  }
};

export const sendConfirmationEmail = async (
  consignment: Consignment
): Promise<void> => {
  try {
    const consigner = consignment.getConsigner();

    if (!consigner) {
      console.error(
        `[sendConfirmationEmail] consignment ${consignment?.id} không có consigner (pointer chưa được include?) — bỏ qua`
      );
      return;
    }

    // Parse User lưu email ở field 'email' (built-in) hoặc 'mail' (custom) — thử cả hai
    const email =
      (consigner.get('email') as string) || (consigner.get('mail') as string);

    if (!email) {
      console.error(
        `[sendConfirmationEmail] consigner ${consigner.id} không có email (field 'email' và 'mail' đều rỗng) — bỏ qua`
      );
      return;
    }

    const data = buildEmailData(consignment);
    const html = await ejs.renderFile(
      EMAIL_PATHS[EMAIL_TYPES.CONSIGNMENT],
      data
    );

    await emailFactory.send({
      mailTo: email,
      title: `Give Away Premium - Biên nhận ký gửi ${consignment.id}`,
      html,
    });
  } catch (error) {
    console.error(
      `[sendConfirmationEmail] Lỗi gửi email cho consignment ${consignment?.id}:`,
      error
    );
    // Không re-throw — fire-and-forget
  }
};

export const reminderConsignmentGroup = async (
  request: Parse.Cloud.FunctionRequest<{ groupId: string }>
): Promise<any> => {
  const { groupId } = request.params;
  const pointerConsignmentGroup = new ConsignmentGroup();
  pointerConsignmentGroup.id = groupId;

  const query = new Parse.Query(Consignment);
  const consignments = await query
    .equalTo('group', pointerConsignmentGroup)
    .include('consigner')
    .limit(1000)
    .find();

  const promises = consignments.map(consignment =>
    remiderConsignment(consignment)
  );

  await Promise.all(promises);

  return { success: true };
};

export const remiderIndividualConsignment = async (
  request: Parse.Cloud.FunctionRequest<{ objectId: string }>
): Promise<any> => {
  const { objectId } = request.params;
  const query = new Parse.Query(Consignment);
  const consignment = await query
    .equalTo('objectId', objectId)
    .include('consigner')
    .first();

  if (!consignment)
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      `invalid consignment ${objectId}`
    );

  remiderConsignment(consignment);

  return { success: true };
};

export const sendConsignmentEmail = async (
  request: Parse.Cloud.FunctionRequest<{ consignmentId: string }>
): Promise<{ success: boolean }> => {
  const { consignmentId } = request.params;
  const query = new Parse.Query(Consignment);
  const consignment = await query
    .equalTo('objectId', consignmentId)
    .include('consigner')
    .first({ useMasterKey: true });

  if (!consignment) {
    throw new Parse.Error(
      Parse.Error.OBJECT_NOT_FOUND,
      `Consignment ${consignmentId} không tồn tại`
    );
  }

  await sendConfirmationEmail(consignment);
  return { success: true };
};

export const sendPaymentConfirmationEmail = async (
  request: Parse.Cloud.FunctionRequest<{ consignmentId: string }>
): Promise<{ success: boolean }> => {
  const { consignmentId } = request.params;

  // 1. Query Consignment + consigner
  const query = new Parse.Query(Consignment);
  const consignment = await query
    .equalTo('objectId', consignmentId)
    .include('consigner')
    .first({ useMasterKey: true });

  if (!consignment) {
    throw new Parse.Error(
      Parse.Error.OBJECT_NOT_FOUND,
      `Consignment ${consignmentId} không tồn tại`
    );
  }

  // 2. Lấy email (fire-and-forget nếu không có email)
  const consigner = consignment.getConsigner();
  if (!consigner) {
    console.error(
      `[sendPaymentConfirmationEmail] consignment ${consignmentId} không có consigner`
    );
    return { success: true };
  }

  const email =
    (consigner.get('email') as string) || (consigner.get('mail') as string);
  if (!email) {
    console.error(
      `[sendPaymentConfirmationEmail] consigner ${consigner.id} không có email`
    );
    return { success: true };
  }

  // 3. Build data
  const productList: any[] = consignment.get('productList') ?? [];
  const rawMoneyBack = (consignment.get('moneyBack') as number) ?? 0;
  const rawNote = (consignment.get('note') as string) ?? '';

  const data: PaymentEmailData = {
    customerName: (consigner.get('name') as string) ?? '',
    phoneNumber: (consigner.get('phone') as string) ?? '',
    identityId: (consigner.get('identityId') as string) ?? '',
    consignmentId: consignment.id,
    numberOfProduct: productList.length,
    bankName: (consignment.get('bankName') as string) ?? '',
    bankId: (consignment.get('bankId') as string) ?? '',
    moneyBack:
      rawMoneyBack > 0
        ? `${rawMoneyBack.toLocaleString('vi-VN')} vnd`
        : '0 vnd',
    note: rawNote || '---',
  };

  console.log(
    `[sendPaymentConfirmationEmail] consignment ${consignmentId} → data:`,
    JSON.stringify(data, null, 2)
  );

  // 4. Render + send (fire-and-forget trên exception email)
  try {
    const html = await ejs.renderFile(EMAIL_PATHS[EMAIL_TYPES.PAYMENT], data);
    await emailFactory.send({
      mailTo: email,
      title: 'Xác nhận chuyển khoản',
      html,
    });
  } catch (error) {
    console.error(
      `[sendPaymentConfirmationEmail] Lỗi gửi email consignment ${consignmentId}:`,
      error
    );
  }

  return { success: true };
};
