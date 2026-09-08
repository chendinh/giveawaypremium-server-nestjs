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
  // Dùng field consignmentId ("47-1126") thay vì Parse objectId
  const consignmentId =
    (consignment.get('consignmentId') as string) || consignment.id;
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
      title: `Give Away Premium thông báo: đơn hàng ${consignment.get('consignmentId') || consignment.id}`, // Subject line
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
      title: `Give Away Premium - Biên nhận ký gửi ${consignment.get('consignmentId') || consignment.id}`,
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
  request: Parse.Cloud.FunctionRequest<{
    consignmentId: string;
    customerName?: string;
    phoneNumber?: string;
    identityId?: string;
    bankName?: string;
    bankId?: string;
    moneyBack?: number;
    note?: string;
  }>
): Promise<{ success: boolean }> => {
  const {
    consignmentId,
    customerName,
    phoneNumber,
    identityId,
    bankName,
    bankId,
    moneyBack,
    note,
  } = request.params;

  // FE đã gửi đầy đủ data — chỉ cần dùng giá trị đó
  // Nếu FE không gửi (lỗi fallback), query lại từ DB
  // Kiểm tra bất kỳ field nào bị thiếu rỗng để trigger fallback
  const isDataIncomplete =
    !customerName ||
    !phoneNumber ||
    !bankName ||
    !bankId ||
    moneyBack === undefined ||
    moneyBack === 0;

  if (isDataIncomplete) {
    console.log(
      `[sendPaymentConfirmationEmail] FE không gửi đủ data (${isDataIncomplete}), query lại từ DB...`
    );
    const query = new Parse.Query(Consignment);
    const consignment = await query
      .equalTo('objectId', consignmentId)
      .include('consigner')
      .first({ useMasterKey: true });

    if (consignment) {
      const consigner = consignment.getConsigner();
      if (consigner) {
        try {
          await consigner.fetch({ useMasterKey: true });
          const productList = consignment.get('productList') ?? [];
          const dbMoneyBack = (consignment.get('moneyBack') as number) ?? 0;
          const dbBankName = (consignment.get('bankName') as string) ?? '';
          const dbBankId = (consignment.get('bankId') as string) ?? '';

          await sendPaymentEmail(
            consigner,
            consignmentId,
            productList.length,
            dbMoneyBack,
            dbBankName,
            dbBankId,
            customerName ?? '',
            phoneNumber ?? '',
            identityId ?? '',
            note ?? ''
          );
        } catch (err) {
          console.error(`[sendPaymentConfirmationEmail] fetch User lỗi:`, err);
        }
      }
    } else {
      console.error(
        `[sendPaymentConfirmationEmail] Consignment ${consignmentId} không tồn tại`
      );
    }
    return { success: true };
  }

  // Dùng data từ FE, nhưng query từ DB nếu thiếu bankName/bankId/moneyBack
  let finalData: PaymentEmailData;
  let finalConsigner: Parse.User;

  // Kiểm tra nếu cần data từ DB (bankName, bankId, moneyBack có thể rỗng từ FE)
  const needsDBData =
    !bankName || !bankId || moneyBack === undefined || moneyBack === 0;

  if (needsDBData) {
    console.log(
      `[sendPaymentConfirmationEmail] bankName/bankId/moneyBack thiếu từ FE, query từ DB...`
    );
    const query = new Parse.Query(Consignment);
    const consignment = await query
      .equalTo('objectId', consignmentId)
      .include('consigner')
      .first({ useMasterKey: true });

    if (!consignment) {
      console.error(`[sendPaymentConfirmationEmail] Consignment không tồn tại`);
      return { success: true };
    }

    const consigner = consignment.getConsigner();
    if (!consigner) {
      console.error(
        `[sendPaymentConfirmationEmail] consignment ${consignmentId} không có consigner`
      );
      return { success: true };
    }

    try {
      await consigner.fetch({ useMasterKey: true });
    } catch (err) {
      console.error(`[sendPaymentConfirmationEmail] fetch User lỗi:`, err);
      return { success: true };
    }

    const dbMoneyBack = (consignment.get('moneyBack') as number) ?? 0;
    const dbBankName = (consignment.get('bankName') as string) ?? '';
    const dbBankId = (consignment.get('bankId') as string) ?? '';
    const productList = consignment.get('productList') ?? [];

    finalData = {
      customerName: customerName ?? '',
      phoneNumber: phoneNumber ?? '',
      identityId: identityId ?? '',
      consignmentId,
      numberOfProduct: productList.length,
      bankName: dbBankName,
      bankId: dbBankId,
      moneyBack:
        dbMoneyBack > 0
          ? `${dbMoneyBack.toLocaleString('vi-VN')} vnd`
          : '0 vnd',
      note: note ?? '---',
    };

    finalConsigner = consigner;
  } else {
    // Dùng data từ FE
    finalData = {
      customerName: customerName ?? '',
      phoneNumber: phoneNumber ?? '',
      identityId: identityId ?? '',
      consignmentId,
      numberOfProduct: 1, // fallback
      bankName: bankName ?? '',
      bankId: bankId ?? '',
      moneyBack:
        (moneyBack ?? 0) > 0
          ? `${((moneyBack ?? 0) * 1000).toLocaleString('vi-VN')} vnd`
          : '0 vnd',
      note: note ?? '---',
    };

    // Query consigner để lấy email
    const query = new Parse.Query(Consignment);
    const consignment = await query
      .equalTo('objectId', consignmentId)
      .include('consigner')
      .first({ useMasterKey: true });

    if (!consignment) {
      console.error(`[sendPaymentConfirmationEmail] Consignment không tồn tại`);
      return { success: true };
    }

    finalConsigner = consignment.getConsigner();
    if (!finalConsigner) {
      console.error(
        `[sendPaymentConfirmationEmail] consignment ${consignmentId} không có consigner`
      );
      return { success: true };
    }

    try {
      await finalConsigner.fetch({ useMasterKey: true });
    } catch (err) {
      console.error(`[sendPaymentConfirmationEmail] fetch User lỗi:`, err);
      return { success: true };
    }
  }

  console.log(
    `[sendPaymentConfirmationEmail] consignment ${consignmentId} → finalData:`,
    JSON.stringify(finalData, null, 2)
  );

  const email =
    (finalConsigner.get('email') as string) ||
    (finalConsigner.get('mail') as string);
  if (!email) {
    console.error(
      `[sendPaymentConfirmationEmail] consigner ${finalConsigner.id} không có email`
    );
    return { success: true };
  }

  // Truyền raw number thẳng vào sendPaymentEmail — tránh strip/format rồi format lại
  const rawMoneyBackValue = !needsDBData
    ? (moneyBack ?? 0) * 1000 // FE gửi đơn vị nghìn → nhân 1000
    : ((finalData as any)._rawMoneyBack ?? 0);

  await sendPaymentEmail(
    finalConsigner,
    consignmentId,
    finalData.numberOfProduct,
    rawMoneyBackValue,
    finalData.bankName,
    finalData.bankId,
    finalData.customerName,
    finalData.phoneNumber,
    finalData.identityId,
    finalData.note
  );
  return { success: true };
};

// Helper để send email với data đã được chuẩn bị
const sendPaymentEmail = async (
  consigner: Parse.User,
  consignmentId: string,
  numberOfProduct: number,
  moneyBack: number,
  bankName: string,
  bankId: string,
  customerName: string,
  phoneNumber: string,
  identityId: string,
  note: string
): Promise<void> => {
  const rawMoneyBack = moneyBack;

  const data: PaymentEmailData = {
    customerName,
    phoneNumber,
    identityId,
    consignmentId,
    numberOfProduct,
    bankName,
    bankId,
    moneyBack:
      rawMoneyBack > 0
        ? `${rawMoneyBack.toLocaleString('vi-VN')} vnd`
        : '0 vnd',
    note: note || '---',
  };

  const email =
    (consigner.get('email') as string) || (consigner.get('mail') as string);

  if (!email) {
    console.error(
      `[sendPaymentEmail] consigner ${consigner.id} không có email`
    );
    return;
  }

  try {
    const html = await ejs.renderFile(EMAIL_PATHS[EMAIL_TYPES.PAYMENT], data);
    await emailFactory.send({
      mailTo: email,
      title: 'Xác nhận chuyển khoản',
      html,
    });
  } catch (error) {
    console.error(
      `[sendPaymentEmail] Lỗi gửi email consignment ${consignmentId}:`,
      error
    );
  }
};
