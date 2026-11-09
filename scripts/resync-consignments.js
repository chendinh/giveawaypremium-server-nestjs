/**
 * One-off script: đồng bộ lại aggregate + productList cho các Consignment bị
 * tính thiếu do lỗi Parse `find()` không limit chỉ trả 100 bản ghi
 * (ký gửi có >100 sản phẩm), cộng 204-1126 bị thiếu 2 dòng productList.
 *
 * Nguồn sự thật là các Product chưa xoá (deletedAt không tồn tại). Script gọi
 * lại đúng hàm server dùng: syncConsignmentStockInternal (dist/…/consignment-sync).
 *
 * Chống rủi ro:
 *   - Chỉ xử lý objectId liệt kê trong TARGETS, kiểm tra chưa xoá + đúng mã.
 *   - Bỏ qua ký gửi dữ liệu cũ: Consignment có đã bán > 0 nhưng tổng
 *     soldNumberProduct của Product = 0 (sync sẽ làm moneyBack về 0).
 *   - Chạy thử bộ validate của Consignment.beforeSave trên productList mới;
 *     lỗi thì bỏ qua ký gửi đó (server sẽ từ chối lưu).
 *   - --apply ghi backup JSON vào tmp/ trước khi sửa.
 *
 * Usage:
 *   node scripts/resync-consignments.js            # dry-run
 *   node scripts/resync-consignments.js --apply    # áp dụng (có backup)
 *
 * Chạy lại sau khi deploy bản sửa findAll() để chắc chắn số liệu không bị
 * ghi đè lại bởi code cũ.
 */
const fs = require('fs');
const path = require('path');
const Parse = require('parse/node');
(function loadEnv() {
  const content = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!(key in process.env)) process.env[key] = v;
  }
})();

const APPLY = process.argv.includes('--apply');
const MK = { useMasterKey: true };

// objectId + tiền tố consignmentId để đối chiếu (tên ký gửi có hậu tố ghi tay).
const TARGETS = [
  { id: 'WPRBu3ffCA', prefix: '68-1126' },
  { id: 'NVintGIic2', prefix: '223-1126' },
  { id: 'jeexca9hxz', prefix: '27-127' },
  { id: 'j0tgmVvEH2', prefix: '008-726' },
  { id: 'wZada0io3R', prefix: '010-726' },
  { id: 'ooM8CtJBVz', prefix: '097-326' },
  { id: 'eKF8Xn6FFe', prefix: '204-1126' },
];

const getRate = price =>
  price <= 0 ? 0 : price < 1000 ? 0.74 : price <= 10000 ? 0.77 : 0.8;
const sum = arr => arr.reduce((s, x) => s + (x || 0), 0);
// moneyBack lưu theo nghìn đồng → hiển thị ×1000
const vnd = k => `${Math.round((k || 0) * 1000).toLocaleString('vi-VN')}đ`;

const FIELDS = [
  'numberOfPoducts',
  'remainNumConsignment',
  'numSoldConsignment',
  'moneyBack',
  'moneyBackForFullSold',
  'totalMoney',
];

async function computeAfter(consignment) {
  const products = await new Parse.Query('Product')
    .equalTo('consignment', consignment)
    .doesNotExist('deletedAt')
    .findAll(MK);
  const productList = products.map(p => ({
    ...p.toJSON(),
    subCategoryId: p.get('subCategory')?.id ?? null,
    categoryId: p.get('category')?.id ?? null,
  }));
  const price = p => p.get('price') ?? 0;
  const after = {
    listLen: products.length,
    numberOfPoducts: sum(products.map(p => p.get('count'))),
    remainNumConsignment: sum(products.map(p => p.get('remainNumberProduct'))),
    numSoldConsignment: sum(products.map(p => p.get('soldNumberProduct'))),
    moneyBack: sum(
      products.map(
        p => price(p) * getRate(price(p)) * (p.get('soldNumberProduct') ?? 0)
      )
    ),
  };
  return { products, productList, after };
}

async function main() {
  Parse.initialize(process.env.APP_ID, undefined, process.env.MASTER_KEY);
  Parse.serverURL = process.env.SERVER_URL;
  global.Parse = Parse; // dist/models/* dùng Parse global
  const {
    beforeSave: consignmentValidate,
  } = require('../dist/cloud/consignment/validate');

  const plan = [];
  for (const t of TARGETS) {
    const c = await new Parse.Query('Consignment').get(t.id, MK);
    const code = c.get('consignmentId') || '';
    console.log(`\n== ${t.prefix}  (${t.id})  "${code}"`);
    if (c.get('deletedAt')) {
      console.log('   BỎ QUA: ký gửi đã xoá');
      continue;
    }
    if (!code.startsWith(t.prefix)) {
      console.log('   BỎ QUA: consignmentId không khớp tiền tố mong đợi');
      continue;
    }
    const { productList, after } = await computeAfter(c);
    const before = {
      listLen: (c.get('productList') || []).length,
      numberOfPoducts: c.get('numberOfPoducts') ?? 0,
      remainNumConsignment: c.get('remainNumConsignment') ?? 0,
      numSoldConsignment: c.get('numSoldConsignment') ?? 0,
      moneyBack: c.get('moneyBack') ?? 0,
    };

    if (before.numSoldConsignment > 0 && after.numSoldConsignment === 0) {
      console.log(
        '   BỎ QUA: dữ liệu cũ (Product không có soldNumberProduct) — sync sẽ đưa moneyBack về 0'
      );
      continue;
    }
    try {
      consignmentValidate.fields.productList.options(productList);
    } catch (e) {
      const msg = Array.isArray(e)
        ? e.map(x => `${x.field}: ${x.message}`).join(' | ')
        : String(e);
      console.log(`   BỎ QUA: productList mới không qua validate server → ${msg}`);
      continue;
    }

    console.log(`   Số dòng sản phẩm : ${before.listLen} → ${after.listLen}`);
    console.log(`   Tổng số lượng    : ${before.numberOfPoducts} → ${after.numberOfPoducts}`);
    console.log(`   Còn tồn          : ${before.remainNumConsignment} → ${after.remainNumConsignment}`);
    console.log(`   Đã bán           : ${before.numSoldConsignment} → ${after.numSoldConsignment}`);
    console.log(`   moneyBack        : ${vnd(before.moneyBack)} → ${vnd(after.moneyBack)}`);
    plan.push({ consignment: c, before, after });
  }

  console.log(`\nSẽ đồng bộ ${plan.length}/${TARGETS.length} ký gửi.`);
  if (!APPLY) {
    console.log('(DRY RUN) Chưa ghi gì. Chạy lại với --apply để áp dụng.');
    return;
  }

  const backupDir = path.resolve(__dirname, '../tmp');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(
    backupDir,
    `resync_consignments_backup_${Date.now()}.json`
  );
  fs.writeFileSync(
    backupFile,
    JSON.stringify(
      plan.map(p => ({
        id: p.consignment.id,
        consignmentId: p.consignment.get('consignmentId'),
        fields: Object.fromEntries(
          [...FIELDS, 'productList'].map(f => [f, p.consignment.get(f)])
        ),
      })),
      null,
      2
    )
  );
  console.log('Backup:', backupFile);

  const {
    syncConsignmentStockInternal,
  } = require('../dist/cloud/function/consignment-sync');
  let failed = 0;
  for (const { consignment } of plan) {
    const r = await syncConsignmentStockInternal({ consignmentId: consignment.id });
    if (r.errors) failed++;
    console.log(`sync ${consignment.id} (${consignment.get('consignmentId').slice(0, 24)}):`, r);
  }

  // Đọc lại từ DB để xác minh khớp với Product
  console.log('\n== Xác minh sau khi sync');
  let mismatched = 0;
  for (const { consignment } of plan) {
    const fresh = await new Parse.Query('Consignment').get(consignment.id, MK);
    const { after } = await computeAfter(fresh);
    const now = {
      listLen: (fresh.get('productList') || []).length,
      numberOfPoducts: fresh.get('numberOfPoducts'),
      remainNumConsignment: fresh.get('remainNumConsignment'),
      numSoldConsignment: fresh.get('numSoldConsignment'),
      moneyBack: fresh.get('moneyBack'),
    };
    const ok =
      now.listLen === after.listLen &&
      now.numberOfPoducts === after.numberOfPoducts &&
      now.remainNumConsignment === after.remainNumConsignment &&
      now.numSoldConsignment === after.numSoldConsignment &&
      Math.abs(now.moneyBack - after.moneyBack) < 0.5;
    if (!ok) mismatched++;
    console.log(
      `${ok ? 'OK ' : 'LỆCH'} ${fresh.get('consignmentId').slice(0, 24).padEnd(24)} dòng=${now.listLen}/${after.listLen} sl=${now.numberOfPoducts}/${after.numberOfPoducts} tồn=${now.remainNumConsignment}/${after.remainNumConsignment} bán=${now.numSoldConsignment}/${after.numSoldConsignment} moneyBack=${vnd(now.moneyBack)}`
    );
  }
  if (failed || mismatched) {
    console.error(`\nCó lỗi: sync lỗi=${failed}, lệch sau sync=${mismatched}`);
    process.exitCode = 1;
  }
}

main().then(
  () => process.exit(process.exitCode || 0),
  e => {
    console.error('Lỗi:', e);
    process.exit(1);
  }
);
