import { Category } from '../../models/category';
import { Consignment } from '../../models/consignment';
import { Product } from '../../models/product';
import { SubCategory } from '../../models/sub.category';
import { getNextConsignmentSeq } from './counter';
import { syncConsignmentStockInternal } from '../function/consignment-sync';

const afterCreate = async (
  request: Parse.Cloud.AfterSaveRequest<Consignment>
) => {
  const consignment = request.object;
  const rawProducts = consignment.get('productList');

  const promises = rawProducts.map(async rawProduct => {
    const pointerCategory = new Category();
    pointerCategory.id = rawProduct.categoryId;
    const pointerSubCategory = new SubCategory();
    pointerSubCategory.id = rawProduct.subCategoryId;

    const data = {
      key: rawProduct.key,
      price: rawProduct.price,
      count: rawProduct.count,
      name: rawProduct.name,
      note: rawProduct.note,
      code: rawProduct.code,
      priceAfterFee: rawProduct.priceAfterFee,
      remainNumberProduct: rawProduct.count,
      soldNumberProduct: 0, // explicit init — tránh null khi sync consignment
      moneyBackProduct: rawProduct.moneyBackProduct,
      consignment: consignment,
      consignee: consignment.get('consignee'),
      consigner: consignment.get('consigner'),
      group: consignment.get('group'),
      category: pointerCategory,
      subCategory: rawProduct.subCategoryId ? pointerSubCategory : undefined,
      rateNew: rawProduct.rateNew,
    };
    const product = new Product();

    return product.save(data, { useMasterKey: true });
  });

  await Promise.all(promises);

  // Tạo N Product song song (Promise.all) khiến mỗi product.afterSave tự trigger
  // syncConsignment() riêng lẻ, không đợi nhau — race condition: các lần sync đọc
  // DB tại các thời điểm khác nhau (số Product chưa đủ) rồi ghi đè lên Consignment,
  // dẫn đến numberOfPoducts/remainNumConsignment/numSoldConsignment bị lệch nhau.
  // Fix: sync lại 1 lần cuối cùng ở đây — sau khi TẤT CẢ product save đã resolve —
  // để đảm bảo giá trị ghi cuối cùng luôn được tính từ snapshot đầy đủ.
  // Dùng bản internal (không check quyền) vì đây là lời gọi server-side nội bộ,
  // không có request.user của client.
  await syncConsignmentStockInternal({ consignmentId: consignment.id });

  // Email xác nhận ký gửi được gửi thủ công từ client sau khi tạo thành công
  // — không gửi tự động ở đây để tránh gửi 2 lần
};

const afterDelete = async (
  request: Parse.Cloud.AfterSaveRequest<Consignment>
) => {
  const consignmentPointer = request.object;
  const prodQuery = new Parse.Query(Product);
  // Chỉ soft-delete các products chưa bị xóa
  const products = await prodQuery
    .equalTo('consignment', consignmentPointer)
    .doesNotExist('deletedAt')
    .find();
  if (!products.length) return;
  try {
    await Parse.Object.saveAll(
      products.map(product => {
        product.set('deletedAt', new Date());
        return product;
      }),
      { useMasterKey: true }
    );
  } catch (err) {
    console.error(
      '[Consignment afterDelete] saveAll failed:',
      err?.message || err
    );
  }
};

const beforeSave = async (request: Parse.Cloud.BeforeSaveRequest) => {
  try {
    const consignment = request.object;

    if (consignment.isNew()) {
      request.context.isNew = true;

      // ── Auto-generate consignmentId server-side để tránh race condition ──
      // Client gửi consignmentId sơ bộ để hiển thị, server sẽ overwrite
      // với giá trị chính xác dựa trên count thực tế trong DB.
      // Ngoại lệ: nếu client set isCustomId = true → giữ nguyên mã client gửi lên
      // (dùng cho KOL/VIP cần mã đặc biệt như "th1-1126").
      // Counter vẫn KHÔNG tăng trong trường hợp này để tránh lệch seq.
      const group = consignment.get('group') as Parse.Object | undefined;
      const isCustomId = consignment.get('isCustomId') as boolean | undefined;

      if (group && group.id) {
        try {
          // Fetch group để lấy code (ví dụ: "926")
          await group.fetch({ useMasterKey: true });
          const groupCode = group.get('code') as string | undefined;

          if (isCustomId) {
            // Mã custom — giữ nguyên consignmentId client gửi lên.
            // Chỉ cập nhật product codes theo mã custom đó.
            const customId = consignment.get('consignmentId') as string;
            const rawProducts = consignment.get('productList');
            if (Array.isArray(rawProducts) && customId) {
              const updatedProductList = rawProducts.map(
                (product: any, idx: number) => ({
                  ...product,
                  code: `${customId}-${idx + 1}`,
                })
              );
              consignment.set('productList', updatedProductList);
            }
          } else {
            // Atomic increment thay vì count() — tránh race condition:
            // 2 request cùng lúc với count() sẽ đếm cùng số → tạo ID trùng.
            // getNextConsignmentSeq() dùng Parse.increment() → MongoDB $inc → atomic.
            const seq = await getNextConsignmentSeq(group.id, group);
            const newConsignmentId = groupCode
              ? `${seq}-${groupCode}`
              : `${seq}`;

            consignment.set('consignmentId', newConsignmentId);

            // Cập nhật code của từng product trong productList theo consignmentId mới
            const rawProducts = consignment.get('productList');
            if (Array.isArray(rawProducts)) {
              const updatedProductList = rawProducts.map(
                (product: any, idx: number) => ({
                  ...product,
                  code: `${newConsignmentId}-${idx + 1}`,
                })
              );
              consignment.set('productList', updatedProductList);
            }
          }
        } catch (err) {
          console.error(
            '[Consignment beforeSave] auto-generate consignmentId error:',
            err
          );
          // Không throw — fallback về giá trị client gửi lên
        }
      }

      // Copy identityId từ consigner vào Consignment để dùng cho email
      const consigner = consignment.get('consigner');
      if (consigner && consigner.id) {
        try {
          await consigner.fetch({ useMasterKey: true });
          const identityId = consigner.get('identityId') as string;
          if (identityId) {
            consignment.set('consignerIdCard', identityId);
          }
        } catch (err) {
          console.error(`[Consignment beforeSave] fetch consigner error:`, err);
        }
      }
    }
    if (consignment.dirty('deletedAt') && consignment.get('deletedAt')) {
      request.context.isDeleted = true;
    }
  } catch (error) {
    throw error;
  }
};

const afterSave = async (
  request: Parse.Cloud.AfterSaveRequest<Consignment>
) => {
  if (request.context.isNew) await afterCreate(request);
  if (request.context.isDeleted) await afterDelete(request);
};

export { beforeSave, afterSave };
