/**
 * One-off script: xoá mềm các Product còn hoạt động nhưng thuộc Consignment đã
 * bị xoá mềm ("sản phẩm mồ côi").
 *
 * Nguyên nhân: Consignment.afterDelete dùng find() không limit nên chỉ xoá mềm
 * được 100 sản phẩm đầu của ký gửi >100 sản phẩm (đã sửa sang findAll()).
 * Sản phẩm mồ côi trùng `code` với ký gửi tạo lại → quét mã có thể lấy nhầm.
 *
 * Chống rủi ro:
 *   - Chỉ động vào Consignment trong EXPECTED_CONSIGNMENTS; mồ côi ở ký gửi
 *     khác chỉ được liệt kê, không sửa.
 *   - Bỏ qua Product đã bán (sold > 0), tồn lệch count, có Order hoặc
 *     OrderRequest tham chiếu.
 *   - Xoá mềm (set deletedAt), không destroy. --apply ghi backup vào tmp/.
 *
 * Usage:
 *   node scripts/soft-delete-orphan-products.js            # dry-run
 *   node scripts/soft-delete-orphan-products.js --apply    # áp dụng
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
// 097-326 (114 sản phẩm, tạo và xoá cùng phút 12/03/2026)
const EXPECTED_CONSIGNMENTS = new Set(['lM2S873LsI']);

// Phân trang theo createdAt (skip lớn dễ lỗi trên Parse)
async function all(makeQuery, size = 200) {
  let out = [];
  let last = null;
  for (;;) {
    let q = makeQuery().ascending('createdAt').limit(size);
    if (last) q = q.greaterThanOrEqualTo('createdAt', last);
    const r = await q.find(MK);
    out = out.concat(r);
    if (r.length < size) break;
    last = r[r.length - 1].createdAt;
  }
  const m = new Map();
  out.forEach(o => m.set(o.id, o));
  return [...m.values()];
}

const pointer = (cls, id) => {
  const o = new Parse.Object(cls);
  o.id = id;
  return o;
};

async function findOrphans() {
  const deleted = await all(() =>
    new Parse.Query('Consignment').exists('deletedAt').select('consignmentId')
  );
  const codeById = new Map(deleted.map(c => [c.id, c.get('consignmentId')]));
  const ids = [...codeById.keys()];
  const orphans = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).map(id => pointer('Consignment', id));
    const r = await new Parse.Query('Product')
      .containedIn('consignment', chunk)
      .doesNotExist('deletedAt')
      .findAll(MK);
    orphans.push(...r);
  }
  return { orphans, codeById, deletedCount: ids.length };
}

async function main() {
  Parse.initialize(process.env.APP_ID, undefined, process.env.MASTER_KEY);
  Parse.serverURL = process.env.SERVER_URL;
  global.Parse = Parse;

  const { orphans, codeById, deletedCount } = await findOrphans();
  console.log(`Ký gửi đã xoá: ${deletedCount}. Sản phẩm mồ côi: ${orphans.length}`);
  if (orphans.length === 0) return;

  const inScope = orphans.filter(p =>
    EXPECTED_CONSIGNMENTS.has(p.get('consignment').id)
  );
  const outOfScope = orphans.filter(p => !inScope.includes(p));
  if (outOfScope.length) {
    console.log(`\nNgoài phạm vi (KHÔNG sửa): ${outOfScope.length}`);
    outOfScope.forEach(p =>
      console.log(`  ${p.id} ${p.get('code')} (ký gửi ${codeById.get(p.get('consignment').id)})`)
    );
  }

  // Tham chiếu từ Order / OrderRequest
  const ids = new Set(inScope.map(p => p.id));
  const orders = await all(() =>
    new Parse.Query('Order').select('productList')
  );
  const referenced = new Set();
  for (const o of orders) {
    for (const line of o.get('productList') || []) {
      if (line && ids.has(line.objectId)) referenced.add(line.objectId);
    }
  }
  const reqs = await new Parse.Query('OrderRequest')
    .containedIn('product', inScope.map(p => pointer('Product', p.id)))
    .findAll(MK);
  reqs.forEach(r => r.get('product') && referenced.add(r.get('product').id));
  console.log(`\nĐã quét ${orders.length} Order và ${reqs.length} OrderRequest liên quan.`);

  const toDelete = [];
  console.log(`\nTrong phạm vi (${inScope.length}):`);
  for (const p of inScope) {
    const sold = p.get('soldNumberProduct') ?? 0;
    const remain = p.get('remainNumberProduct') ?? 0;
    const count = p.get('count') ?? 0;
    let skip = '';
    if (sold !== 0) skip = `đã bán ${sold}`;
    else if (remain !== count) skip = `tồn ${remain} ≠ count ${count}`;
    else if (referenced.has(p.id)) skip = 'có Order/OrderRequest tham chiếu';
    console.log(
      `  ${skip ? 'BỎ QUA' : 'XOÁ  '} ${p.id} ${String(p.get('code')).padEnd(14)} count=${count} remain=${remain} sold=${sold}${skip ? '  → ' + skip : ''}`
    );
    if (!skip) toDelete.push(p);
  }
  console.log(`\nSẽ xoá mềm ${toDelete.length}/${inScope.length} sản phẩm.`);
  if (!APPLY) {
    console.log('(DRY RUN) Chưa ghi gì. Chạy lại với --apply để áp dụng.');
    return;
  }
  if (toDelete.length === 0) return;

  const backupDir = path.resolve(__dirname, '../tmp');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(
    backupDir,
    `soft_delete_orphans_backup_${Date.now()}.json`
  );
  fs.writeFileSync(
    backupFile,
    JSON.stringify(
      toDelete.map(p => ({
        id: p.id,
        code: p.get('code'),
        consignment: p.get('consignment').id,
        deletedAt: null, // hoàn tác: unset deletedAt
      })),
      null,
      2
    )
  );
  console.log('Backup:', backupFile);

  const when = new Date();
  for (const p of toDelete) {
    p.set('deletedAt', when);
    await p.save(null, MK);
    console.log('Đã xoá mềm', p.id, p.get('code'));
  }

  // Sync cuối để Consignment đã xoá về 0 sản phẩm (tránh số liệu cũ do trigger
  // chạy bất đồng bộ)
  const {
    syncConsignmentStockInternal,
  } = require('../dist/cloud/function/consignment-sync');
  for (const cid of new Set(toDelete.map(p => p.get('consignment').id))) {
    console.log('sync', cid, await syncConsignmentStockInternal({ consignmentId: cid }));
  }

  const after = await findOrphans();
  console.log(`\nSau khi xoá: sản phẩm mồ côi còn lại = ${after.orphans.length}`);
  if (after.orphans.length) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode || 0),
  e => {
    console.error('Lỗi:', e);
    process.exit(1);
  }
);
