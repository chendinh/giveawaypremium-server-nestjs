// import { NhanhProductService } from "../../external-services/nhanh";
// import { nhanhConfigs } from "../../config/nhanh.config";
// import { Product, ProductInventory, ProductStatusEnums } from "../../models/product";

// export const pushProductToNhanh = async (
//   request: Parse.Cloud.FunctionRequest
// ): Promise<Product> => {
//   try {
//     const {params} = request;
//     const { productId, count } = params;
//     if (!productId || !count || count < 0) throw new Parse.Error(Parse.Error.VALIDATION_ERROR,"Invlid Param");
    
//     const query = new Parse.Query(Product);
//     const product = await query
//       .equalTo('objectId', productId)
//       .doesNotExist('nhanhProduct')
//       .first();
//     if (!product) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `invalid product ${product}`);
//     const inventory = product.get('inventory') as ProductInventory;
//     const { available } = inventory;
//     if (count > available) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `count maximum ${available}`);
//     const nhanhProductService = new NhanhProductService(nhanhConfigs);
//     const nhanhProducts = await nhanhProductService.create([
//       {
//         id: product.id,
//         name: product.get('name'),
//         price: product.get('price'),
//         status: 'New',
//         code: product.get('code'),
//       }
//     ]);
//     const nhanhDetail = await nhanhProductService.findByNhanhId(nhanhProducts.ids[product.id]);
//     inventory.offline = count;
//     inventory.available = inventory.available - count;

//     return product.save({
//       nhanhProduct: nhanhDetail,
//       inventory: inventory
//     }, { useMasterKey: true });
//   } catch (error) {
//     throw error;
//   }
// };


// export const activeProduct = async (
//   request: Parse.Cloud.FunctionRequest
// ): Promise<Product> => {
//   try {
//     const {params} = request;
//     const { productId, count } = params;
//     if (!productId || !count || count < 0) throw new Parse.Error(Parse.Error.VALIDATION_ERROR,"Invlid Param");
    
//     const query = new Parse.Query(Product);
//     const product = await query.get(productId);
//     const status = product.get('status');
//     if (![ProductStatusEnums.AVAILABLE, ProductStatusEnums.ACTIVE].includes(status)) throw new Parse.Error(
//       Parse.Error.VALIDATION_ERROR, 
//       `product not available`
//     );
//     const inventory = product.get('inventory') as ProductInventory;
//     const { available } = inventory;
//     if (count > available) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `count maximum ${available}`);
//     inventory.active = inventory.active + count;
//     inventory.available = inventory.available - count;

//     return product.save({
//       status: ProductStatusEnums.ACTIVE,
//       inventory: inventory
//     }, { useMasterKey: true });
//   } catch (error) {
//     throw error;
//   }
// };
