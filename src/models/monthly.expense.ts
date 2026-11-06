/**
 * MonthlyExpense — chi phí vận hành của một tháng (lương nhân viên, điện nước,
 * chi phí khác...) do quản lý nhập, dùng để tính lợi nhuận sau chi phí trên báo
 * cáo kiểm kê. Chỉ server (master key) được ghi/đọc — xem cloud/finance-guard.
 *
 * Fields:
 *   month          string   — 'YYYY-MM', duy nhất
 *   items          { id, label, amountVnd, note }[]
 *   totalVnd       number   — tổng items, tính lại mỗi lần lưu
 *   updatedById / updatedByName
 *   history        { at, byId, byName, totalVnd, itemCount }[]  — chỉ thêm, không sửa
 */
export class MonthlyExpense extends Parse.Object {
  constructor() {
    super('MonthlyExpense');
  }
}

Parse.Object.registerSubclass('MonthlyExpense', MonthlyExpense);
