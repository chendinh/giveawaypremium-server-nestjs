/**
 * Chặn mọi truy cập từ client (REST/SDK) vào các class tài chính do server quản lý.
 *
 * Parse Server mặc định cho phép client có App ID + REST key (nằm sẵn trong bundle
 * frontend) tạo/sửa/đọc object của mọi class. Với BankTransaction nghĩa là nhân viên
 * có thể tự tạo "giao dịch ngân hàng" giả để đối chiếu khớp; với ReportAttachment là
 * có thể sửa/xoá chứng từ. Chỉ code server (master key) mới được thao tác trực tiếp;
 * client đi qua các Cloud Function có kiểm tra quyền administrator.
 */
const MASTER_ONLY_CLASSES = [
  'BankTransaction',
  'ReportAttachment',
  'MonthlyExpense',
  'MonthlyReportSnapshot',
] as const;

const masterOnly = (request: { master?: boolean }): void => {
  if (!request.master) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Dữ liệu này chỉ truy cập được thông qua server'
    );
  }
};

export const registerFinanceGuards = (): void => {
  for (const className of MASTER_ONLY_CLASSES) {
    Parse.Cloud.beforeSave(className, masterOnly);
    Parse.Cloud.beforeDelete(className, masterOnly);
    Parse.Cloud.beforeFind(className, masterOnly);
  }
};
