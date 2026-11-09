import {
  requireAdminRole,
  requireReportViewerRole,
} from '../../../common/require-admin';
import { MONTH_REGEX } from '../../../common/vn-time';
import { ReportAttachment } from '../../../models/report.attachment';

export const ATTACHMENT_KINDS = [
  'payout_bill',
  'bank_statement',
  'other',
] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

const MAX_NOTE_LENGTH = 500;
const MIN_REASON_LENGTH = 3;

export interface ReportAttachmentDto {
  id: string;
  month: string;
  kind: AttachmentKind;
  note: string;
  url: string;
  thumbUrl: string;
  uploadedByName: string;
  createdAt: string;
  /** Chứng từ đã bị gỡ vẫn được liệt kê để giám đốc thấy ai gỡ, khi nào, vì sao */
  deleted: boolean;
  deletedAt: string | null;
  deletedByName: string | null;
  deleteReason: string | null;
}

const displayName = (user: Parse.User): string =>
  String(user.get('fullName') || user.get('username') || '');

/** Ảnh Cloudinary → bản thu nhỏ để hiển thị lưới nhanh. URL khác giữ nguyên. */
const toThumbUrl = (url: string): string =>
  url.includes('/upload/')
    ? url.replace('/upload/', '/upload/c_limit,w_480,q_auto,f_auto/')
    : url;

const toDto = (obj: Parse.Object): ReportAttachmentDto => {
  const url = String(obj.get('url') || '');
  const deletedAt = obj.get('deletedAt') as Date | undefined;
  return {
    id: obj.id,
    month: String(obj.get('month')),
    kind: obj.get('kind') as AttachmentKind,
    note: String(obj.get('note') || ''),
    url,
    thumbUrl: toThumbUrl(url),
    uploadedByName: String(obj.get('uploadedByName') || ''),
    createdAt: obj.createdAt.toISOString(),
    deleted: !!deletedAt,
    deletedAt: deletedAt ? deletedAt.toISOString() : null,
    deletedByName: obj.get('deletedByName') || null,
    deleteReason: obj.get('deleteReason') || null,
  };
};

/** Cloud Function: listReportAttachments — chứng từ đính kèm báo cáo của một tháng. */
export const listReportAttachments = async (
  request: Parse.Cloud.FunctionRequest<{ month: string }>
): Promise<ReportAttachmentDto[]> => {
  await requireReportViewerRole(request.user);
  const { month } = request.params;

  const items = await new Parse.Query(ReportAttachment)
    .equalTo('month', month)
    .ascending('createdAt')
    .limit(500)
    .find({ useMasterKey: true });
  return items.map(toDto);
};

/**
 * Cloud Function: addReportAttachment
 *
 * Ảnh đã được tải lên qua POST /media (Cloudinary + object Media). Hàm này chỉ đính
 * kèm vào báo cáo tháng. URL ảnh được lấy từ Media trong DB chứ không tin giá trị
 * client gửi lên.
 */
export const addReportAttachment = async (
  request: Parse.Cloud.FunctionRequest<{
    month: string;
    kind: AttachmentKind;
    mediaId: string;
    note?: string;
  }>
): Promise<ReportAttachmentDto> => {
  const admin = await requireAdminRole(request.user);
  const { month, kind, mediaId } = request.params;
  const note = String(request.params.note || '').trim();

  if (!MONTH_REGEX.test(month) || !ATTACHMENT_KINDS.includes(kind)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Tham số không hợp lệ');
  }
  if (note.length > MAX_NOTE_LENGTH) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      `Ghi chú tối đa ${MAX_NOTE_LENGTH} ký tự`
    );
  }

  const media = await new Parse.Query('Media').get(mediaId, {
    useMasterKey: true,
  });
  const url = (media.get('data') as { secure_url?: string } | undefined)
    ?.secure_url;
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      'Ảnh tải lên không hợp lệ hoặc chưa lưu xong'
    );
  }

  const attachment = new ReportAttachment();
  await attachment.save(
    {
      month,
      kind,
      media,
      url,
      note,
      uploadedById: admin.id,
      uploadedByName: displayName(admin),
    },
    { useMasterKey: true }
  );

  // Ảnh đã được dùng nên không còn là bản nháp. Không chặn luồng chính nếu lỗi.
  media.save({ isDraft: false }, { useMasterKey: true }).catch(() => undefined);

  return toDto(attachment);
};

/** Cloud Function: deleteReportAttachment — gỡ mềm, bắt buộc có lý do, giữ lại vết. */
export const deleteReportAttachment = async (
  request: Parse.Cloud.FunctionRequest<{
    attachmentId: string;
    reason: string;
  }>
): Promise<{ ok: true }> => {
  const admin = await requireAdminRole(request.user);
  const { attachmentId } = request.params;
  const reason = String(request.params.reason || '').trim();

  if (reason.length < MIN_REASON_LENGTH) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      'Vui lòng nhập lý do gỡ chứng từ'
    );
  }

  const attachment = await new Parse.Query(ReportAttachment).get(attachmentId, {
    useMasterKey: true,
  });
  if (attachment.get('deletedAt')) {
    throw new Parse.Error(
      Parse.Error.VALIDATION_ERROR,
      'Chứng từ này đã được gỡ trước đó'
    );
  }

  await attachment.save(
    {
      deletedAt: new Date(),
      deletedById: admin.id,
      deletedByName: displayName(admin),
      deleteReason: reason,
    },
    { useMasterKey: true }
  );
  return { ok: true };
};
