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
  price: string; // formatted: "1,500,000 vnd"
  priceAfterFee: string; // formatted: "1,350,000 vnd"
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

/**
 * QUY ƯỚC ĐƠN VỊ TIỀN: mọi số tiền lưu trong DB (price, priceAfterFee,
 * moneyBack, ...) và số nhân viên nhập trên admin đều tính theo NGHÌN ĐỒNG
 * (100 = 100.000đ) cho nhập nhanh. Số tiền hiển thị cho khách trong email phải
 * đi qua hàm này để nhân ×1000 trở lại. Làm tròn về đồng nguyên, khớp
 * formatVND ở màn hình admin.
 */
const formatThousandsAsVnd = (
  valueInThousands: number | undefined | null
): string => {
  const vnd = Math.round((Number(valueInThousands) || 0) * 1000);
  return vnd > 0 ? `${vnd.toLocaleString('vi-VN')} vnd` : '0 vnd';
};

export function buildEmailData(consignment: Consignment): ConsignmentEmailData {
  const consigner = consignment.getConsigner();

  // Parse User fields: fullName (không phải 'name'), phoneNumber (không phải 'phone'),
  // identityNumber (không phải 'identityId') — khớp với schema trong setCustomer/updateCustomer
  const customerName =
    (consigner?.get('fullName') as string) ||
    (consigner?.get('name') as string) ||
    '';
  const phoneNumber =
    (consigner?.get('phoneNumber') as string) ||
    (consigner?.get('phone') as string) ||
    '';
  const identityId =
    (consigner?.get('identityNumber') as string) ||
    (consigner?.get('identityId') as string) ||
    '';
  // Dùng field consignmentId ("47-1126") thay vì Parse objectId
  const consignmentId =
    (consignment.get('consignmentId') as string) || consignment.id;
  // Consignment không có field bankName/bankId riêng — thông tin ngân hàng
  // nằm trong banks[0] (array), khớp với schema client gửi lên (setConsignment)
  const consignmentBanks = consignment.get('banks') as
    | Array<{ type?: string; accNumber?: string }>
    | undefined;
  const bankName = consignmentBanks?.[0]?.type ?? '';
  const bankId = consignmentBanks?.[0]?.accNumber ?? '';
  const timeGetMoney = (consignment.get('timeGetMoney') as string) ?? '';

  const timeCheck = timeGetMoney
    ? moment(timeGetMoney, 'DD-MM-YYYY')
        .subtract(3, 'days')
        .format('DD-MM-YYYY')
    : '';

  const productList: RawProduct[] = consignment.get('productList') ?? [];
  // Tổng số lượng sản phẩm (sum of count), không phải số dòng
  const numberOfProduct = productList.reduce(
    (sum, p) => sum + (Number(p.count) || 1),
    0
  );

  // productList lưu price/priceAfterFee theo nghìn đồng → formatThousandsAsVnd ×1000 để ra giá thật
  const products: ProductEmailItem[] = productList.map(rawProduct => ({
    name: rawProduct.name,
    amount: rawProduct.count,
    status: rawProduct.rateNew ?? '',
    price: formatThousandsAsVnd(rawProduct.price),
    priceAfterFee: formatThousandsAsVnd(rawProduct.priceAfterFee),
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
    let consigner = consignment.getConsigner();

    if (!consigner) {
      console.error(
        `[sendConfirmationEmail] consignment ${consignment?.id} không có consigner (pointer chưa được include?) — bỏ qua`
      );
      return;
    }

    // Fetch user với master key để đảm bảo lấy đủ tất cả field
    // (include('consigner') chỉ trả public fields, có thể thiếu phoneNumber/identityNumber)
    try {
      await consigner.fetch({ useMasterKey: true });
    } catch (fetchErr) {
      console.error(
        `[sendConfirmationEmail] fetch consigner ${consigner.id} lỗi:`,
        fetchErr
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
    // ⚠ Đây là Parse objectId (client gửi item.objectId), KHÔNG phải mã ký gửi
    // hiển thị trên mail. Chỉ dùng để query/log; mã hiển thị và số lượng lấy
    // từ DB qua buildEmailData(consignment).
    consignmentId,
    customerName,
    phoneNumber,
    identityId,
    bankName,
    bankId,
    moneyBack,
    note,
  } = request.params;

  // Luôn đọc DB: cần consigner (lấy email) và là nguồn dự phòng cho mọi field
  // FE gửi thiếu/rỗng
  const consignment = await new Parse.Query(Consignment)
    .equalTo('objectId', consignmentId)
    .include('consigner')
    .first({ useMasterKey: true });

  if (!consignment) {
    console.error(
      `[sendPaymentConfirmationEmail] Consignment ${consignmentId} không tồn tại`
    );
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
    // Một số field của User (phoneNumber, identityNumber, email) chỉ đọc được
    // sau khi fetch với master key
    await consigner.fetch({ useMasterKey: true });
  } catch (err) {
    console.error(`[sendPaymentConfirmationEmail] fetch User lỗi:`, err);
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

  // Dữ liệu từ DB, cùng nguồn với mail biên nhận ký gửi: mã ký gửi hiển thị,
  // tổng số lượng, thông tin khách, ngân hàng
  const dbData = buildEmailData(consignment);

  // Ưu tiên giá trị FE gửi lên (số nhân viên đang thấy trên màn hình); thiếu
  // hoặc rỗng thì lấy DB. Riêng mã ký gửi và số lượng luôn lấy từ DB.
  // moneyBack của FE lẫn DB đều tính theo nghìn đồng → formatThousandsAsVnd ×1000.
  const feMoneyBack = Number(moneyBack) || 0;
  const data: PaymentEmailData = {
    customerName: customerName || dbData.customerName,
    phoneNumber: phoneNumber || dbData.phoneNumber,
    identityId: identityId || dbData.identityId,
    consignmentId: dbData.consignmentId,
    numberOfProduct: dbData.numberOfProduct,
    bankName: bankName || dbData.bankName,
    bankId: bankId || dbData.bankId,
    moneyBack: formatThousandsAsVnd(
      feMoneyBack > 0 ? feMoneyBack : (consignment.get('moneyBack') as number)
    ),
    note: note || '---',
  };

  console.log(
    `[sendPaymentConfirmationEmail] consignment ${consignmentId} → data:`,
    JSON.stringify(data, null, 2)
  );

  await sendPaymentEmail(email, data);
  return { success: true };
};

// Render payment.ejs rồi gửi. Lỗi render/gửi chỉ log, không throw (fire-and-forget)
const sendPaymentEmail = async (
  mailTo: string,
  data: PaymentEmailData
): Promise<void> => {
  try {
    const html = await ejs.renderFile(EMAIL_PATHS[EMAIL_TYPES.PAYMENT], data);
    await emailFactory.send({
      mailTo,
      title: 'Xác nhận chuyển khoản',
      html,
    });
  } catch (error) {
    console.error(
      `[sendPaymentEmail] Lỗi gửi email consignment ${data.consignmentId}:`,
      error
    );
  }
};
