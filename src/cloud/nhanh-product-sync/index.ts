// import { NhanhProductService } from '../../external-services/nhanh/nhanh.product';
// import { nhanhConfigs } from "../../config/nhanh.config";
// import { Product } from "../../models/product";

// const nhanhProductSync = async (): Promise<void> => {
//   const nhanhProductService = new NhanhProductService(nhanhConfigs);
//   const query = new Parse.Query(Product);

//   const count = await query.count();
//   const loopLength = count < 1000 ? 1 : (Math.floor(count/1000) + 1);
//   for (let i = 0; i < loopLength; i++) {
//     const query = new Parse.Query(Product);
//     const products = await query.limit(1000).find();
//     for (let j = 0; j < products.length; j++) {
//       const product = products[j];
//       try {
//         if (product.get('nhanhProduct')) {
//           const idNhanh = product.get('nhanhProduct')['idNhanh'] || '';
//           const nhanhProduct = await nhanhProductService.findByNhanhId(idNhanh);
//           product.save({
//             nhanhProduct: nhanhProduct,
//             nhanhSyncStatus: 'SUCCESS'
//           }, { useMasterKey: true });
//         }
        
//       } catch (error) {
//         product.save({
//           nhanhSyncStatus: 'FAILED',
//           nhanhSyncError:  {
//             error: JSON.stringify(error),
//             stack: error.stack
//           },
//         }, { useMasterKey: true });
//       }
//     }
//   }
// };

// export {
//   nhanhProductSync
// };
