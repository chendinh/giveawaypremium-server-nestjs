/**
 * One-off script: sửa đơn hàng bị bán nhầm vào Product đã soft-delete.
 *
 * Bối cảnh: ký gửi bị xoá mềm rồi tạo lại cùng mã → Product cũ (deletedAt) và
 * Product mới trùng `code`. Màn Bán hàng tìm theo code không lọc deletedAt nên
 * đơn trỏ vào Product đã xoá; trigger Order bỏ qua Product đã xoá nên Product
 * đang dùng không bị trừ tồn.
 *
 * Với mỗi dòng sản phẩm của Order (chưa xoá) trỏ vào Product đã xoá:
 *   - tìm Product đang dùng cùng `code` (phải đúng 1 kết quả)
 *   - chỉ xử lý khi Product đó chưa bán gì (soldNumberProduct = 0, remain >= count)
 *     → những case còn lại chỉ in ra để xem tay, không tự sửa
 *   - repoint dòng đó sang Product đang dùng, trừ tồn, re-sync Consignment
 *
 * Usage:
 *   node scripts/fix-orders-on-deleted-products.js            # dry-run
 *   node scripts/fix-orders-on-deleted-products.js --apply    # áp dụng (có backup)
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

async function all(makeQuery) {
  let out = [];
  let last = null;
  for (;;) {
    let q = makeQuery().ascending('createdAt').limit(200);
    if (last) q = q.greaterThanOrEqualTo('createdAt', last);
    const r = await q.find(MK);
    out = out.concat(r);
    if (r.length < 200) break;
    last = r[r.length - 1].createdAt;
  }
  const m = new Map();
  out.forEach(o => m.set(o.id, o));
  return [...m.values()];
}

async function main() {
  Parse.initialize(process.env.APP_ID, undefined, process.env.MASTER_KEY);
  Parse.serverURL = process.env.SERVER_URL;

  const deleted = await all(() =>
    new Parse.Query('Product').exists('deletedAt').select('code')
  );
  const deletedIds = new Set(deleted.map(p => p.id));
  const orders = await all(() =>
    new Parse.Query('Order').doesNotExist('deletedAt').select('productList')
  );

  const fixes = []; // { order, index, line, active }
  const manual = [];
  const wanted = new Map(); // activeId -> total count planned
  for (const o of orders) {
    const list = o.get('productList') || [];
    for (let idx = 0; idx < list.length; idx++) {
      const line = list[idx];
      if (!line.objectId || !deletedIds.has(line.objectId)) continue;
      const actives = await new Parse.Query('Product')
        .equalTo('code', line.code)
        .doesNotExist('deletedAt')
        .find(MK);
      if (actives.length !== 1) {
        manual.push({
          order: o.id,
          code: line.code,
          reason: `${actives.length} active`,
        });
        continue;
      }
      const a = actives[0];
      const planned = (wanted.get(a.id) || 0) + line.count;
      const sold = a.get('soldNumberProduct') ?? 0;
      const remain = a.get('remainNumberProduct') ?? 0;
      if (sold !== 0 || remain < planned) {
        manual.push({
          order: o.id,
          code: line.code,
          reason: `active sold=${sold} remain=${remain}`,
        });
        continue;
      }
      wanted.set(a.id, planned);
      fixes.push({ order: o, index: idx, line, active: a });
    }
  }

  console.log(`Cần sửa tự động: ${fixes.length} dòng đơn`);
  fixes.forEach(f =>
    console.log(
      `  order ${f.order.id} ${f.line.code} x${f.line.count}: ${f.line.objectId} → ${f.active.id}`
    )
  );
  console.log(
    `Bỏ qua (không có Product đang dùng / đã có bán): ${manual.length}`
  );
  if (!APPLY) {
    console.log('\n(DRY RUN) Chạy lại với --apply để áp dụng.');
    return;
  }

  const backupDir = path.resolve(__dirname, '../tmp');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(
    backupDir,
    `fix_orders_deleted_products_backup_${Date.now()}.json`
  );
  const backup = {
    orders: fixes.map(f => ({
      id: f.order.id,
      productList: f.order.get('productList'),
    })),
    products: [...wanted.keys()].map(id => {
      const f = fixes.find(x => x.active.id === id);
      return {
        id,
        sold: f.active.get('soldNumberProduct'),
        remain: f.active.get('remainNumberProduct'),
      };
    }),
  };
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log('Backup:', backupFile);

  // 1) Repoint dòng đơn (gộp theo order để save 1 lần)
  const byOrder = new Map();
  for (const f of fixes) {
    if (!byOrder.has(f.order.id))
      byOrder.set(f.order.id, {
        order: f.order,
        list: JSON.parse(JSON.stringify(f.order.get('productList'))),
      });
    const entry = byOrder.get(f.order.id);
    const item = entry.list[f.index];
    item.objectId = f.active.id;
    const cid = f.active.get('consignment') && f.active.get('consignment').id;
    if (cid) item.consignment = { objectId: cid };
  }
  for (const { order, list } of byOrder.values()) {
    order.set('productList', list);
    await order.save(null, MK);
    console.log('Đã repoint order', order.id);
  }

  // 2) Trừ tồn Product đang dùng
  const consignmentIds = new Set();
  for (const [activeId, total] of wanted) {
    const p = fixes.find(f => f.active.id === activeId).active;
    p.increment('soldNumberProduct', total);
    p.decrement('remainNumberProduct', total);
    await p.save(null, MK);
    const cid = p.get('consignment') && p.get('consignment').id;
    if (cid) consignmentIds.add(cid);
    console.log(`Đã trừ tồn ${activeId} (${p.get('code')}) -${total}`);
  }

  // 3) Re-sync Consignment aggregate + productList
  global.Parse = Parse; // dist/models/* dùng Parse global
  const {
    syncConsignmentStockInternal,
  } = require('../dist/cloud/function/consignment-sync');
  for (const id of consignmentIds) {
    console.log(
      'sync',
      id,
      await syncConsignmentStockInternal({ consignmentId: id })
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Lỗi:', e);
    process.exit(1);
  });
