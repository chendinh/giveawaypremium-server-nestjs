import { USER_ROLES } from '../../constants/user-roles';

/**
 * Cloud Function: updateUserByAdmin
 *
 * Cho phép admin cập nhật thông tin của bất kỳ user nào bằng master key,
 * bypassing Parse ACL (vốn chỉ cho user tự cập nhật chính mình).
 *
 * Quyền: requireUser + field role === 'administrator' trên user object
 * (hệ thống dùng field role trực tiếp trên _User, không dùng bảng _Role)
 */
export const updateUserByAdmin = async (
  request: Parse.Cloud.FunctionRequest<{
    userId: string;
    data: Record<string, unknown>;
  }>
): Promise<{ updatedAt: string }> => {
  const { user, params } = request;

  // Kiểm tra user đăng nhập
  if (!user) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, 'Yêu cầu đăng nhập');
  }

  // Fetch lại user với master key để đọc đủ field (session token chỉ trả field public)
  const fullUser = await new Parse.Query(Parse.User).get(user.id, {
    useMasterKey: true,
  });

  const userRole = fullUser.get('role') as string | undefined;

  if (userRole !== USER_ROLES.ADMIN) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Chỉ admin mới có thể cập nhật thông tin người dùng'
    );
  }

  const { userId, data } = params;

  if (!userId) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'userId là bắt buộc');
  }

  // Lấy user cần update bằng master key
  const userQuery = new Parse.Query(Parse.User);
  const targetUser = await userQuery.get(userId, { useMasterKey: true });

  if (!targetUser) {
    throw new Parse.Error(
      Parse.Error.OBJECT_NOT_FOUND,
      `User ${userId} không tồn tại`
    );
  }

  // Chỉ cho phép cập nhật các field an toàn (whitelist)
  const ALLOWED_FIELDS = [
    'fullName',
    'phoneNumber',
    'identityNumber',
    'mail',
    'birthday',
    'banks',
    'totalMoneyForSale',
    'numberOfSale',
    'totalProductForSale',
  ];

  for (const field of ALLOWED_FIELDS) {
    if (data[field] !== undefined) {
      targetUser.set(field, data[field]);
    }
  }

  await targetUser.save(null, { useMasterKey: true });

  return {
    updatedAt: targetUser.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
};
