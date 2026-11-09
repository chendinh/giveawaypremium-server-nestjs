import { USER_ROLES } from '../constants/user-roles';

/**
 * Kiểm tra request đến từ user đã đăng nhập VÀ có role nằm trong `allowedRoles`.
 * Dùng để thay thế `requireMaster: true` trên các Cloud Function/Trigger
 * nhạy cảm — tránh phụ thuộc vào Master Key (vốn khó xoay/khó audit ai đang dùng),
 * chuyển sang cơ chế phân quyền theo user + role (dễ audit, dễ revoke qua session).
 *
 * Hệ thống dùng field `role` trực tiếp trên `_User` (không dùng bảng `_Role` của Parse).
 *
 * Lưu ý: hàm vẫn dùng `{ useMasterKey: true }` NỘI BỘ để fetch đầy đủ field `role`
 * của user (session token mặc định chỉ trả field public) và để thực thi hành động
 * sau khi đã xác thực role — không phải để bypass auth của request.
 *
 * @throws Parse.Error SESSION_MISSING nếu chưa đăng nhập
 * @throws Parse.Error OPERATION_FORBIDDEN nếu role không nằm trong `allowedRoles`
 */
export const requireRole = async (
  user: Parse.User | undefined,
  allowedRoles: readonly USER_ROLES[],
  forbiddenMessage: string
): Promise<Parse.User> => {
  if (!user) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, 'Yêu cầu đăng nhập');
  }
  const fullUser = await new Parse.Query(Parse.User).get(user.id, {
    useMasterKey: true,
  });
  const userRole = fullUser.get('role') as USER_ROLES | undefined;
  if (!userRole || !allowedRoles.includes(userRole)) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, forbiddenMessage);
  }
  return fullUser;
};

/** Chỉ role administrator. Dùng cho thao tác ghi/nhạy cảm. */
export const requireAdminRole = (
  user: Parse.User | undefined
): Promise<Parse.User> =>
  requireRole(
    user,
    [USER_ROLES.ADMIN],
    'Chỉ administrator mới có quyền thực hiện hành động này'
  );

/**
 * Administrator hoặc manager. Chỉ dùng cho các hàm ĐỌC của báo cáo
 * (/admin/bao-cao): manager được xem, mọi thao tác ghi vẫn chỉ administrator.
 */
export const requireReportViewerRole = (
  user: Parse.User | undefined
): Promise<Parse.User> =>
  requireRole(
    user,
    [USER_ROLES.ADMIN, USER_ROLES.MANAGER],
    'Chỉ administrator hoặc manager mới có quyền xem báo cáo'
  );
