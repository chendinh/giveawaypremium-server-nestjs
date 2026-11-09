import { VN_OFFSET_MS } from '../../common/vn-time';
import { NormalizedBankTx } from '../../external-services/sepay/sepay.types';
import { Consignment } from '../../models/consignment';
import logger from '../../plugins/logger';
import { sendPaymentConfirmationEmail } from '../function/mail';
import {
  safeMoneyBack,
  thousandsToVnd,
  toNumber,
} from '../function/report/derive';
import { AMOUNT_TOLERANCE_VND, normalizeText } from '../function/report/matcher';

/**
 * Tự đánh dấu ký gửi "đã trả" khi SePay báo có tiền ra khớp.
 *
 * Nội dung chuyển khoản do QR trên admin tạo ra có dạng "TRA 47 1126" (mã ký
 * gửi "47-1126", dấu phân cách đổi thành khoảng trắng vì nhiều ngân hàng bỏ ký
 * tự đặc biệt). Chỉ tự đánh dấu khi ĐỦ cả ba điều kiện:
 *   1. Tiền ra, nội dung có "TRA <mã>" và mã trỏ đúng MỘT ký gửi chưa xoá.
 *   2. Ký gửi đó chưa được đánh dấu đã trả.
 *   3. Số tiền khớp số phải trả (sai lệch ≤ AMOUNT_TOLERANCE_VND).
 * Thiếu một điều kiện thì bỏ qua, để nhân viên xử lý tay và để mục đối chiếu
 * hiện "lệch tiền" như trước.
 */

/** "TRA", rồi tối đa 2 cụm chữ-số: "TRA 47 1126", "TRA 47-1126", "TRA TH1 1126". */
const PAY_CONTENT_PATTERN =
  /(?<![A-Z0-9])TRA[\s:._-]+([A-Z0-9]+)(?:[\s._/-]+([A-Z0-9]+))?/;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const pad = (n: number): string => String(n).padStart(2, '0');

/** Giờ VN dạng 'dd-MM-yyyy HH:mm' (định dạng timeConfirmGetMoney) và 'dd/MM/yyyy HH:mm' (dòng audit). */
const formatVn = (date: Date): { field: string; note: string } => {
  const v = new Date(date.getTime() + VN_OFFSET_MS);
  const day = pad(v.getUTCDate());
  const month = pad(v.getUTCMonth() + 1);
  const time = `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  return {
    field: `${day}-${month}-${v.getUTCFullYear()} ${time}`,
    note: `${day}/${month}/${v.getUTCFullYear()} ${time}`,
  };
};

/** Trích hai cụm mã từ nội dung chuyển khoản; null nếu không có "TRA <mã>". */
export const extractPayCodeParts = (
  content: string,
  description: string
): string[] | null => {
  const haystack = normalizeText(`${content} ${description}`);
  const match = PAY_CONTENT_PATTERN.exec(haystack);
  if (!match) return null;
  return [match[1], match[2]].filter((part): part is string => !!part);
};

/**
 * Tìm ký gửi theo mã. Chỉ nhận khi ra đúng một kết quả: trùng mã (hiếm, do
 * mã tuỳ chỉnh) thì không đoán.
 */
const findConsignmentByCode = async (
  parts: string[]
): Promise<Consignment | null> => {
  // Mã chuẩn luôn có dạng "<số>-<mã nhóm>" nên cần đủ 2 cụm; 1 cụm quá ngắn
  // để phân biệt với số bất kỳ trong nội dung.
  if (parts.length < 2) return null;
  const body = parts.map(escapeRegExp).join('[\\s._/-]?');
  const found = await new Parse.Query(Consignment)
    .matches('consignmentId', new RegExp(`^${body}$`, 'i'))
    .doesNotExist('deletedAt')
    .limit(2)
    .find({ useMasterKey: true });
  return found.length === 1 ? (found[0] as Consignment) : null;
};

const markPaid = async (
  consignment: Consignment,
  tx: NormalizedBankTx
): Promise<void> => {
  const code = String(consignment.get('consignmentId') || consignment.id);
  const when = formatVn(tx.occurredAt);
  const auditLine =
    `[${when.note}] SePay xác nhận ĐÃ TRẢ TIỀN cho đơn ${code}` +
    ` (tự động từ sao kê, mã tham chiếu ${tx.referenceCode || '---'})`;
  const note = String(consignment.get('note') || '');

  consignment.set('isGetMoney', true);
  consignment.set('timeConfirmGetMoney', when.field);
  // Báo cáo chỉ đối chiếu ngân hàng với ký gửi trả bằng chuyển khoản.
  consignment.set('isTransferMoneyWithBank', true);
  consignment.set('note', note ? `${note}\n---\n${auditLine}` : auditLine);
  await consignment.save(null, { useMasterKey: true });

  // Cùng email xác nhận như khi nhân viên bấm tay; lỗi gửi mail không được
  // làm hỏng việc đánh dấu (hàm này tự nuốt lỗi gửi, bọc thêm cho chắc).
  try {
    await sendPaymentConfirmationEmail({
      params: { consignmentId: consignment.id },
    } as Parse.Cloud.FunctionRequest<{ consignmentId: string }>);
  } catch (err) {
    logger.error(
      `[autoMarkPaid] gửi email xác nhận ${code} lỗi: ${(err as Error)?.message || err}`
    );
  }

  logger.info(
    `[autoMarkPaid] đã đánh dấu đã trả ký gửi ${code} từ giao dịch ${tx.referenceCode || tx.fingerprint}`
  );
};

/**
 * Gọi với các giao dịch MỚI vừa được lưu. Không bao giờ throw: lỗi ở đây
 * không được làm webhook trả lỗi (SePay sẽ gửi lại và gây xử lý trùng).
 */
export const autoMarkPaidFromTransactions = async (
  items: NormalizedBankTx[]
): Promise<number> => {
  let marked = 0;
  for (const tx of items) {
    if (tx.type !== 'out') continue;
    try {
      const parts = extractPayCodeParts(tx.content, tx.description);
      if (!parts) continue;

      const consignment = await findConsignmentByCode(parts);
      if (!consignment) continue;
      if (consignment.get('isGetMoney') === true) continue;

      const expectedVnd = thousandsToVnd(
        safeMoneyBack(
          toNumber(consignment.get('moneyBack')),
          toNumber(consignment.get('totalMoney'))
        )
      );
      if (Math.abs(expectedVnd - tx.amountVnd) > AMOUNT_TOLERANCE_VND) {
        logger.warn(
          `[autoMarkPaid] bỏ qua ${consignment.get('consignmentId')}: ` +
            `chuyển ${tx.amountVnd}đ, phải trả ${expectedVnd}đ`
        );
        continue;
      }

      await markPaid(consignment, tx);
      marked += 1;
    } catch (err) {
      logger.error(
        `[autoMarkPaid] lỗi xử lý giao dịch ${tx.referenceCode || tx.fingerprint}: ${(err as Error)?.message || err}`
      );
    }
  }
  return marked;
};
