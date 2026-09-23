import { USER_ROLES } from '../constants/user-roles';

/**
 * Kiểm tra request đến từ user đã đăng nhập VÀ có role === 'administrator'.
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
 * @throws Parse.Error OPERATION_FORBIDDEN nếu role !== administrator
 */
export const requireAdminRole = async (
  user: Parse.User | undefined
): Promise<Parse.User> => {
  if (!user) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, 'Yêu cầu đăng nhập');
  }

  const fullUser = await new Parse.Query(Parse.User).get(user.id, {
    useMasterKey: true,
  });

  const userRole = fullUser.get('role') as string | undefined;

  if (userRole !== USER_ROLES.ADMIN) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Chỉ administrator mới có quyền thực hiện hành động này'
    );
  }

  return fullUser;
};
