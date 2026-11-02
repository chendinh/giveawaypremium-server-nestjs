/**
 * One-off script: audit + fix remainNumberProduct cho Consignment "263-926".
 *
 * Bug: remainNumberProduct đã bị cộng sai từ trước (count và soldNumberProduct đúng).
 * Fix đúng: remainNumberProduct = count - soldNumberProduct cho từng Product,
 * sau đó re-sync các field aggregate trên Consignment (remainNumConsignment, ...).
 *
 * Usage:
 *   node scripts/fix-remain-263-926.js            # dry-run, chỉ in ra chênh lệch
 *   node scripts/fix-remain-263-926.js --apply     # áp dụng fix thật
 */
const fs = require('fs');
const path = require('path');
const Parse = require('parse/node');

// Load .env thủ công (không phụ thuộc dotenv — package không có trong node_modules)
(function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
})();

const APPLY = process.argv.includes('--apply');
const CODE = '263-926';

async function main() {
  Parse.initialize(process.env.APP_ID, undefined, process.env.MASTER_KEY);
  Parse.serverURL = process.env.SERVER_URL;

  const consignment = await new Parse.Query('Consignment')
    .equalTo('consignmentId', CODE)
    .doesNotExist('deletedAt')
    .first({ useMasterKey: true });

  if (!consignment) {
    console.error(`Không tìm thấy Consignment với consignmentId = "${CODE}"`);
    process.exit(1);
  }

  console.log(`Tìm thấy Consignment ${consignment.id} (consignmentId=${CODE})`);

  const consignmentPointer = new Parse.Object('Consignment');
  consignmentPointer.id = consignment.id;

  const products = await new Parse.Query('Product')
    .equalTo('consignment', consignmentPointer)
    .doesNotExist('deletedAt')
    .limit(1000)
    .find({ useMasterKey: true });

  console.log(`Có ${products.length} Product thuộc consignment này.\n`);

  const toFix = [];

  for (const p of products) {
    const count = p.get('count') ?? 0;
    const sold = p.get('soldNumberProduct') ?? 0;
    const remain = p.get('remainNumberProduct') ?? 0;
    const correctRemain = count - sold;

    if (remain !== correctRemain) {
      toFix.push({ product: p, count, sold, remain, correctRemain });
      console.log(
        `[SAI] ${p.id} "${p.get('name')}" — count=${count} sold=${sold} ` +
          `remain(hiện tại)=${remain} → remain(đúng)=${correctRemain}`
      );
    }
  }

  if (toFix.length === 0) {
    console.log('Không có Product nào bị sai remainNumberProduct.');
    return;
  }

  console.log(`\nTổng: ${toFix.length}/${products.length} product bị sai.`);

  if (!APPLY) {
    console.log(
      '\n(DRY RUN) Không có gì được lưu. Chạy lại với --apply để áp dụng fix.'
    );
    return;
  }

  for (const { product, correctRemain } of toFix) {
    product.set('remainNumberProduct', correctRemain);
    await product.save(null, { useMasterKey: true });
    console.log(`Đã sửa ${product.id} → remainNumberProduct=${correctRemain}`);
  }

  // Re-sync aggregate fields trên Consignment sau khi Product đã đúng
  const {
    syncConsignmentStockInternal,
  } = require('../dist/cloud/function/consignment-sync');
  const result = await syncConsignmentStockInternal({
    consignmentId: consignment.id,
  });
  console.log('\nĐã re-sync Consignment aggregate fields:', result);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Lỗi:', err);
    process.exit(1);
  });
