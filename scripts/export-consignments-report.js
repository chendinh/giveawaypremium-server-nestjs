/**
 * Script xuất báo cáo Excel tổng hợp TẤT CẢ đơn ký gửi (Consignment) trong một khoảng
 * thời gian (mặc định: từ 01/01/2026 tới hôm nay, theo giờ Việt Nam UTC+7).
 *
 * Dữ liệu lấy TRỰC TIẾP từ Parse Server (production) bằng Master Key.
 * Script này CHỈ ĐỌC (read-only) — không có bất kỳ lệnh ghi/update/xóa nào.
 *
 * Cách dùng:
 *   node scripts/export-consignments-report.js
 *   node scripts/export-consignments-report.js --from=2026-01-01 --to=2026-10-12
 *   node scripts/export-consignments-report.js --out=tmp/exports/bao-cao-thang10.xlsx
 *   node scripts/export-consignments-report.js --include-deleted   # gồm cả đơn đã soft-delete
 *   node scripts/export-consignments-report.js --exclude-test=true # loại các đơn test/QA (mã có "test-store", "QATEST"...)
 *
 * Output: file .xlsx với 3 sheet:
 *   1. "Tổng quan"         — số liệu tổng + bảng thống kê theo tháng
 *   2. "Đơn ký gửi"        — 1 dòng / 1 Consignment
 *   3. "Chi tiết sản phẩm" — 1 dòng / 1 Product (flatten từ productList của từng đơn)
 *
 * LƯU Ý: file xuất ra chứa thông tin cá nhân khách hàng (tên, SĐT, CMND/CCCD) —
 * không commit file này vào git, không chia sẻ công khai.
 *
 * LƯU Ý VỀ SỐ LIỆU TIỀN: toàn bộ số lượng/tiền (SL, đã bán, còn lại, tổng giá trị,
 * tiền phải trả KH...) được TÍNH LẠI trực tiếp từ các Product thật của mỗi đơn,
 * KHÔNG lấy từ field cache trên Consignment (numberOfProducts, numSoldConsignment,
 * totalMoney, moneyBack, moneyBackForFullSold...). Lý do: đối chiếu dữ liệu thật
 * phát hiện field cache `moneyBack` bị sai đơn vị (gấp ~1000 lần) ở 27/2347 đơn
 * ký gửi (tạo trong khoảng 03/01/2026 – 11/06/2026) — bug dữ liệu đã có từ trước,
 * không phải do script này. Xem chi tiết tại hàm computeAggregates().
 */
const fs = require('fs');
const path = require('path');
const Parse = require('parse/node');
const moment = require('moment');
const ExcelJS = require('exceljs');

// ───────────────────────────── Load .env thủ công ─────────────────────────────
// Package `dotenv` không có trong node_modules của repo này — load tay giống
// cách scripts/fix-remain-263-926.js đã làm, để không cần thêm dependency mới.
(function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
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

// ───────────────────────────── CLI args ─────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [k, ...rest] = arg.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : 'true'];
  })
);

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7 — toàn bộ mốc ngày trong script này tính theo giờ VN

/** Lấy {y, m, d} theo giờ Việt Nam từ một thời điểm UTC (Date) */
function toVnYmd(date) {
  const shifted = new Date(date.getTime() + VN_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  };
}

/** 'YYYY-MM-DD' (giờ VN) → Date UTC tương ứng 00:00:00 hoặc 23:59:59.999 giờ VN */
function vnDateStringToUtc(dateStr, endOfDay) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) {
    throw new Error(
      `Ngày không hợp lệ: "${dateStr}" (định dạng cần: YYYY-MM-DD)`
    );
  }
  const ms = endOfDay
    ? Date.UTC(y, m - 1, d, 23, 59, 59, 999)
    : Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  return new Date(ms - VN_OFFSET_MS);
}

const todayVn = toVnYmd(new Date());
const defaultTo = `${todayVn.y}-${String(todayVn.m).padStart(2, '0')}-${String(
  todayVn.d
).padStart(2, '0')}`;

const FROM_STR = args.from || '2026-01-01';
const TO_STR = args.to || defaultTo;
const INCLUDE_DELETED = args['include-deleted'] === 'true';
// Mặc định GIỮ LẠI mọi bản ghi (đúng nghĩa "tất cả" đơn ký gửi) — chỉ loại các
// đơn test/QA rõ ràng khi người dùng chủ động truyền --exclude-test=true.
const EXCLUDE_TEST = args['exclude-test'] === 'true';

/**
 * Nhận diện đơn ký gửi tạo ra để TEST/QA chức năng (không phải giao dịch thật
 * với khách hàng) — dựa trên mã đơn hoặc tên khách rõ ràng chứa dấu hiệu test.
 * Chỉ áp dụng khi chạy với --exclude-test=true; mặc định các đơn này VẪN được
 * giữ trong báo cáo để không tự ý bỏ dữ liệu ngoài yêu cầu.
 */
function isTestConsignment(c) {
  const id = String(c.get('consignmentId') || '');
  const consignerName = String(c.get('consignerName') || '');
  return (
    /test-store/i.test(id) ||
    /qatest/i.test(id) ||
    /^test\s/i.test(consignerName) ||
    /^qa test/i.test(consignerName)
  );
}

const fromDate = vnDateStringToUtc(FROM_STR, false);
const toDate = vnDateStringToUtc(TO_STR, true);

if (fromDate > toDate) {
  console.error(`Lỗi: --from (${FROM_STR}) phải trước --to (${TO_STR}).`);
  process.exit(1);
}

const DEFAULT_OUT = path.resolve(
  __dirname,
  `../tmp/exports/bao-cao-don-ky-gui_${FROM_STR}_den_${TO_STR}.xlsx`
);
const OUT_PATH = args.out ? path.resolve(process.cwd(), args.out) : DEFAULT_OUT;

// ───────────────────────────── Nhãn tiếng Việt (fallback) ─────────────────────────────
// Chỉ dùng khi Category không có field `name` sẵn (phòng hờ dữ liệu thiếu).
// Ưu tiên luôn đọc `.get('name')` thật từ DB trước (query đã include category/subCategory).
const CATEGORY_LABEL_FALLBACK = {
  '0paqD5jvw3': 'Thời trang',
  B3OQuAChW1: 'Thiết bị làm đẹp',
  YIUniNrIKb: 'Nước hoa',
  PtUHtoonRc: 'Giày',
  dNYERCGnBT: 'Túi & ví',
  OwyMj5kQ2N: 'Mỹ phẩm',
  eMxuZ7VdUy: 'Dụng cụ trang điểm',
};

// ───────────────────────────── Helpers format ─────────────────────────────
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
// Giá trong DB lưu theo đơn vị NGHÌN VNĐ (price=500 nghĩa là 500.000đ) — luôn ×1000 khi xuất.
const toVnd = thousand => Math.round(num(thousand) * 1000);
const MONEY_FMT = '#,##0 "đ"';

function fmtDateVn(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return moment(value).utcOffset(7).format('DD/MM/YYYY HH:mm');
  }
  if (typeof value === 'object' && value.iso) {
    return moment(value.iso).utcOffset(7).format('DD/MM/YYYY HH:mm');
  }
  // Đã là string định dạng sẵn (vd "DD-MM-YYYY") → giữ nguyên
  return String(value);
}

function monthKeyVn(date) {
  const { y, m } = toVnYmd(date);
  return `${y}-${String(m).padStart(2, '0')}`;
}

function monthLabelVn(key) {
  const [y, m] = key.split('-');
  return `Tháng ${m}/${y}`;
}

/** Sinh danh sách tất cả tháng (giờ VN) giữa 2 mốc — để không bị "mất" tháng 0 đơn trong báo cáo */
function monthRangeVn(from, to) {
  const months = [];
  const { y: y1, m: m1 } = toVnYmd(from);
  const { y: y2, m: m2 } = toVnYmd(to);
  let y = y1;
  let m = m1;
  while (y < y2 || (y === y2 && m <= m2)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * `note` trên Consignment trộn lẫn ghi chú thật của nhân viên với audit-log tự
 * động (mỗi lần sửa đơn trên admin UI, hệ thống append một đoạn bắt đầu bằng
 * "[dd/mm/yyyy HH:mm] ..." nối bằng separator "\n---\n").
 * Giữ lại đúng cách TableConsignemntScreen (client) đang hiển thị: bỏ các đoạn
 * audit-log, chỉ giữ ghi chú thật do người dùng nhập.
 */
function cleanNote(rawNote) {
  if (!rawNote) return '';
  return rawNote
    .split('\n---\n')
    .filter(s => !s.trim().startsWith('['))
    .join('\n---\n')
    .trim();
}

/**
 * Tính lại các số liệu tổng hợp của một Consignment TRỰC TIẾP từ danh sách
 * Product thật của nó, thay vì tin vào các field cache trên Consignment
 * (numberOfProducts, numSoldConsignment, remainNumConsignment, totalMoney,
 * moneyBack, moneyBackForFullSold).
 *
 * LÝ DO: Kiểm tra chéo trên dữ liệu production (2347 đơn, 01/2026 → nay) cho thấy
 * các field cache này có thể bị lệch so với Product thật — nặng nhất là field
 * `moneyBack`, bị sai ĐƠN VỊ (gấp ~1000 lần giá trị đúng) ở 27 đơn ký gửi cũ
 * (03/01/2026 – 11/06/2026). Đây là lỗi dữ liệu đã tồn tại sẵn trong DB, không
 * phải do script này gây ra — nhiều khả năng do một lần sửa tay/migrate dữ liệu
 * trước đó. Các field cấp Product (price, count, soldNumberProduct,
 * remainNumberProduct, priceAfterFee) được xác minh khớp 100% với công thức
 * tính phí (74/77/80%), nên dùng chúng làm nguồn tính toán đáng tin cậy hơn.
 *
 * Đơn vị trả về: giống DB — tiền tính theo NGHÌN VNĐ (chưa ×1000).
 */
function computeAggregates(items) {
  let numberOfProducts = 0;
  let sold = 0;
  let remain = 0;
  let totalMoney = 0; // nghìn VNĐ — sum(price * count)
  let moneyBack = 0; // nghìn VNĐ — sum(priceAfterFee * soldNumberProduct)
  let moneyBackFull = 0; // nghìn VNĐ — sum(priceAfterFee * count)

  for (const p of items) {
    const price = num(p.get('price'));
    const priceAfterFee = num(p.get('priceAfterFee'));
    const count = num(p.get('count'));
    const soldQty = num(p.get('soldNumberProduct'));
    const remainQty = num(p.get('remainNumberProduct'));

    numberOfProducts += count;
    sold += soldQty;
    remain += remainQty;
    totalMoney += price * count;
    moneyBack += priceAfterFee * soldQty;
    moneyBackFull += priceAfterFee * count;
  }

  return {
    numberOfProducts,
    sold,
    remain,
    totalMoney,
    moneyBack,
    moneyBackFull,
  };
}

// ───────────────────────────── Query Parse (read-only) ─────────────────────────────
async function findAllPaginated(buildQuery, { limit = 1000 } = {}) {
  const all = [];
  let skip = 0;
  // Parse Server REST cap limit=1000/request — phải phân trang bằng skip cho tới khi hết.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const q = buildQuery();
    q.limit(limit).skip(skip);
    const batch = await q.find({ useMasterKey: true });
    all.push(...batch);
    if (batch.length < limit) break;
    skip += limit;
  }
  return all;
}

async function fetchConsignments() {
  return findAllPaginated(() => {
    const q = new Parse.Query('Consignment');
    q.greaterThanOrEqualTo('createdAt', fromDate);
    q.lessThanOrEqualTo('createdAt', toDate);
    if (!INCLUDE_DELETED) q.doesNotExist('deletedAt');
    q.include(['consigner', 'consignee', 'group']);
    q.ascending('createdAt');
    q.addAscending('objectId'); // tie-breaker để phân trang ổn định
    return q;
  });
}

async function fetchProductsForConsignments(consignments) {
  if (consignments.length === 0) return [];
  const pointers = consignments.map(c => {
    const ptr = new Parse.Object('Consignment');
    ptr.id = c.id;
    return ptr;
  });

  const results = [];
  // Chunk pointers để tránh query string quá dài khi containedIn với số lượng lớn
  for (const group of chunk(pointers, 50)) {
    const batch = await findAllPaginated(() => {
      const q = new Parse.Query('Product');
      q.containedIn('consignment', group);
      if (!INCLUDE_DELETED) q.doesNotExist('deletedAt');
      q.include(['category', 'subCategory']);
      q.ascending('createdAt');
      return q;
    });
    results.push(...batch);
  }
  return results;
}

// ───────────────────────────── Excel helpers ─────────────────────────────
const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E78' },
};
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

function styleHeaderAndFreeze(ws) {
  const row = ws.getRow(1);
  row.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };
  });
  row.height = 24;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const lastCol = ws.getColumn(ws.columns.length).letter;
  ws.autoFilter = `A1:${lastCol}1`;
}

// ───────────────────────────── Main ─────────────────────────────
async function main() {
  if (
    !process.env.APP_ID ||
    !process.env.MASTER_KEY ||
    !process.env.SERVER_URL
  ) {
    throw new Error(
      'Thiếu APP_ID / MASTER_KEY / SERVER_URL trong .env — không thể kết nối Parse Server.'
    );
  }

  Parse.initialize(process.env.APP_ID, undefined, process.env.MASTER_KEY);
  Parse.serverURL = process.env.SERVER_URL;

  console.log(
    `Đang lấy dữ liệu Consignment từ ${FROM_STR} đến ${TO_STR} (giờ VN)...`
  );
  console.log(
    `Server: ${process.env.SERVER_URL}${INCLUDE_DELETED ? ' (bao gồm đơn đã xóa)' : ''}`
  );

  let consignments = await fetchConsignments();
  console.log(`→ Tìm thấy ${consignments.length} đơn ký gửi.`);

  const testConsignments = consignments.filter(isTestConsignment);
  if (testConsignments.length > 0) {
    console.log(
      `⚠ Phát hiện ${testConsignments.length} đơn có vẻ là đơn TEST/QA (không phải giao dịch khách thật), ví dụ: ` +
        testConsignments
          .slice(0, 5)
          .map(c => c.get('consignmentId'))
          .join(', ')
    );
    if (EXCLUDE_TEST) {
      console.log(
        '  → Đã LOẠI các đơn này khỏi báo cáo (--exclude-test=true).'
      );
      consignments = consignments.filter(c => !isTestConsignment(c));
    } else {
      console.log(
        '  → Vẫn GIỮ các đơn này trong báo cáo (mặc định). Chạy lại với --exclude-test=true nếu muốn loại bỏ.'
      );
    }
  }

  const products = await fetchProductsForConsignments(consignments);
  console.log(`→ Tìm thấy ${products.length} sản phẩm thuộc các đơn trên.`);

  const productsByConsignment = new Map();
  for (const p of products) {
    const cid = p.get('consignment')?.id;
    if (!cid) continue;
    if (!productsByConsignment.has(cid)) productsByConsignment.set(cid, []);
    productsByConsignment.get(cid).push(p);
  }

  // Số liệu tiền/số lượng dùng xuyên suốt báo cáo được tính lại từ Product thật
  // (xem giải thích chi tiết tại computeAggregates) — KHÔNG dùng field cache
  // trên Consignment vì đã phát hiện bị lệch dữ liệu ở một số đơn cũ.
  const aggregatesByConsignment = new Map();
  for (const c of consignments) {
    aggregatesByConsignment.set(
      c.id,
      computeAggregates(productsByConsignment.get(c.id) || [])
    );
  }

  // ─────────── Build workbook — tạo sheet theo ĐÚNG thứ tự hiển thị trước, điền dữ liệu sau ───────────
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GiveAwayPremium - export-consignments-report.js';
  wb.created = new Date();

  const wsSummary = wb.addWorksheet('Tổng quan');
  const wsConsignment = wb.addWorksheet('Đơn ký gửi');
  const wsProduct = wb.addWorksheet('Chi tiết sản phẩm');

  // ── Sheet 2: Đơn ký gửi (1 dòng / 1 Consignment) ──
  wsConsignment.columns = [
    { header: 'STT', key: 'stt', width: 6 },
    { header: 'Mã KG', key: 'consignmentId', width: 14 },
    { header: 'Ngày tạo', key: 'createdAt', width: 18 },
    { header: 'Đợt ký gửi', key: 'groupCode', width: 12 },
    { header: 'Tên khách ký gửi', key: 'consignerName', width: 22 },
    { header: 'SĐT', key: 'phoneNumber', width: 14 },
    { header: 'CMND/CCCD', key: 'idCard', width: 16 },
    { header: 'Email', key: 'email', width: 24 },
    { header: 'Người nhận hàng', key: 'consigneeName', width: 20 },
    { header: 'SL sản phẩm', key: 'numberOfProducts', width: 12 },
    { header: 'Đã bán', key: 'sold', width: 10 },
    { header: 'Còn lại', key: 'remain', width: 10 },
    { header: 'Tổng giá trị ký gửi', key: 'totalMoney', width: 18 },
    { header: 'Tiền phải trả KH', key: 'moneyBack', width: 18 },
    { header: 'Dự kiến nếu bán hết', key: 'moneyBackFull', width: 18 },
    { header: 'Hình thức nhận tiền', key: 'paymentMethod', width: 16 },
    { header: 'Ngân hàng', key: 'bankName', width: 16 },
    { header: 'Số tài khoản', key: 'bankAcc', width: 16 },
    { header: 'Trạng thái thanh toán', key: 'paymentStatus', width: 18 },
    { header: 'Thời gian trả tiền', key: 'timeConfirmGetMoney', width: 16 },
    { header: 'Hẹn trả tiền', key: 'timeGetMoney', width: 14 },
    { header: 'Ghi chú', key: 'note', width: 32 },
    { header: 'Mã nội bộ (objectId)', key: 'objectId', width: 16 },
  ];

  consignments.forEach((c, idx) => {
    const consigner = c.get('consigner');
    const consignee = c.get('consignee');
    const group = c.get('group');
    const banks = c.get('banks') || [];
    const bank0 = banks[0] || {};
    const agg = aggregatesByConsignment.get(c.id);

    wsConsignment.addRow({
      stt: idx + 1,
      consignmentId: c.get('consignmentId') || '',
      createdAt: fmtDateVn(c.get('createdAt')),
      groupCode: (group && group.get('code')) || '',
      consignerName:
        c.get('consignerName') ||
        (consigner && consigner.get('fullName')) ||
        '',
      phoneNumber:
        c.get('phoneNumber') ||
        (consigner && consigner.get('phoneNumber')) ||
        '',
      idCard:
        c.get('consignerIdCard') ||
        (consigner &&
          (consigner.get('identityNumber') || consigner.get('identityId'))) ||
        '',
      email: c.get('mail') || (consigner && consigner.get('email')) || '',
      consigneeName:
        c.get('consigneeName') ||
        (consignee && consignee.get('fullName')) ||
        '',
      numberOfProducts: agg.numberOfProducts,
      sold: agg.sold,
      remain: agg.remain,
      totalMoney: toVnd(agg.totalMoney),
      moneyBack: toVnd(agg.moneyBack),
      moneyBackFull: toVnd(agg.moneyBackFull),
      paymentMethod: c.get('isTransferMoneyWithBank')
        ? 'Chuyển khoản'
        : 'Trực tiếp',
      bankName: bank0.type || c.get('bankName') || '',
      bankAcc: bank0.accNumber || c.get('bankId') || '',
      paymentStatus: c.get('isGetMoney') ? 'Đã trả' : 'Chưa trả',
      timeConfirmGetMoney: fmtDateVn(c.get('timeConfirmGetMoney')),
      timeGetMoney: fmtDateVn(c.get('timeGetMoney')),
      note: cleanNote(c.get('note')),
      objectId: c.id,
    });
  });

  ['totalMoney', 'moneyBack', 'moneyBackFull'].forEach(key => {
    wsConsignment.getColumn(key).numFmt = MONEY_FMT;
  });
  wsConsignment.getColumn('note').alignment = { wrapText: true };
  styleHeaderAndFreeze(wsConsignment);

  // ── Sheet 3: Chi tiết sản phẩm (1 dòng / 1 Product) ──
  wsProduct.columns = [
    { header: 'STT', key: 'stt', width: 6 },
    { header: 'Mã KG', key: 'consignmentId', width: 14 },
    { header: 'Mã SP', key: 'code', width: 16 },
    { header: 'Tên sản phẩm', key: 'name', width: 32 },
    { header: 'Loại', key: 'category', width: 16 },
    { header: 'Loại con', key: 'subCategory', width: 16 },
    { header: 'Tình trạng', key: 'condition', width: 16 },
    { header: 'Giá ký gửi', key: 'price', width: 16 },
    { header: 'Giá sau phí', key: 'priceAfterFee', width: 16 },
    { header: 'SL', key: 'count', width: 8 },
    { header: 'Đã bán', key: 'sold', width: 10 },
    { header: 'Còn lại', key: 'remain', width: 10 },
    { header: 'Tiền trả KH (SP này)', key: 'moneyBackProduct', width: 18 },
    { header: 'Trạng thái SP', key: 'status', width: 14 },
    { header: 'Ghi chú SP', key: 'note', width: 28 },
    { header: 'Ngày tạo', key: 'createdAt', width: 18 },
  ];

  const consignmentIdByObjectId = new Map(
    consignments.map(c => [c.id, c.get('consignmentId') || c.id])
  );

  let productRowIdx = 0;
  for (const c of consignments) {
    const items = productsByConsignment.get(c.id) || [];
    for (const p of items) {
      productRowIdx++;
      const rateNewNum = Number(p.get('rateNew'));
      const condition = Number.isFinite(rateNewNum)
        ? rateNewNum >= 100
          ? 'Hàng mới'
          : 'Hàng đã qua sử dụng'
        : String(p.get('rateNew') ?? '');
      const categoryPtr = p.get('category');
      const subCategoryPtr = p.get('subCategory');

      wsProduct.addRow({
        stt: productRowIdx,
        consignmentId: consignmentIdByObjectId.get(c.id) || '',
        code: p.get('code') || '',
        name: p.get('name') || '',
        category:
          (categoryPtr && categoryPtr.get('name')) ||
          CATEGORY_LABEL_FALLBACK[categoryPtr && categoryPtr.id] ||
          '',
        subCategory: (subCategoryPtr && subCategoryPtr.get('name')) || '',
        condition,
        price: toVnd(p.get('price')),
        priceAfterFee: toVnd(p.get('priceAfterFee')),
        count: num(p.get('count')),
        sold: num(p.get('soldNumberProduct')),
        remain: num(p.get('remainNumberProduct')),
        // Tính lại = giá sau phí × SL đã bán — field cache `moneyBackProduct`
        // trong DB không được backend cập nhật sau khi bán (luôn 0/thiếu), xem
        // ghi chú ở computeAggregates() cho lý do tương tự ở cấp Consignment.
        moneyBackProduct: toVnd(
          num(p.get('priceAfterFee')) * num(p.get('soldNumberProduct'))
        ),
        status: p.get('status') || '',
        note: p.get('note') || '',
        createdAt: fmtDateVn(p.get('createdAt')),
      });
    }
  }

  ['price', 'priceAfterFee', 'moneyBackProduct'].forEach(key => {
    wsProduct.getColumn(key).numFmt = MONEY_FMT;
  });
  wsProduct.getColumn('note').alignment = { wrapText: true };
  styleHeaderAndFreeze(wsProduct);

  // ── Sheet 1: Tổng quan (số liệu tổng + bảng theo tháng) ──
  const totalMoneyAll = consignments.reduce(
    (s, c) => s + toVnd(aggregatesByConsignment.get(c.id).totalMoney),
    0
  );
  const moneyBackAll = consignments.reduce(
    (s, c) => s + toVnd(aggregatesByConsignment.get(c.id).moneyBack),
    0
  );
  const moneyBackPaid = consignments
    .filter(c => c.get('isGetMoney'))
    .reduce(
      (s, c) => s + toVnd(aggregatesByConsignment.get(c.id).moneyBack),
      0
    );
  const moneyBackUnpaid = moneyBackAll - moneyBackPaid;
  const paidCount = consignments.filter(c => c.get('isGetMoney')).length;

  const infoRows = [
    { label: 'Báo cáo', value: 'Tổng hợp đơn ký gửi' },
    { label: 'Khoảng thời gian', value: `${FROM_STR} đến ${TO_STR}` },
    {
      label: 'Ngày xuất báo cáo',
      value: moment().utcOffset(7).format('DD/MM/YYYY HH:mm'),
    },
    { label: '', value: '' },
    { label: 'Tổng số đơn ký gửi', value: consignments.length },
    { label: 'Tổng số sản phẩm', value: products.length },
    { label: 'Tổng giá trị ký gửi', value: totalMoneyAll, money: true },
    { label: 'Tổng tiền phải trả KH', value: moneyBackAll, money: true },
    { label: '  - Đã thanh toán', value: moneyBackPaid, money: true },
    { label: '  - Chưa thanh toán', value: moneyBackUnpaid, money: true },
    { label: 'Số đơn đã trả tiền', value: paidCount },
    { label: 'Số đơn chưa trả tiền', value: consignments.length - paidCount },
  ];
  infoRows.forEach(({ label, value, money }) => {
    const row = wsSummary.addRow([label, value]);
    if (money) row.getCell(2).numFmt = MONEY_FMT;
  });
  wsSummary.getColumn(1).font = { bold: true };

  wsSummary.addRow([]);
  wsSummary.addRow([]);
  const monthHeaders = [
    'Tháng',
    'Số đơn',
    'SL sản phẩm',
    'Đã bán',
    'Tổng giá trị ký gửi',
    'Tiền phải trả KH',
    'Đã thanh toán',
    'Chưa thanh toán',
  ];
  const tableHeaderRow = wsSummary.addRow(monthHeaders);
  tableHeaderRow.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });

  const months = monthRangeVn(fromDate, toDate);
  const byMonth = new Map(
    months.map(m => [
      m,
      { count: 0, qty: 0, sold: 0, total: 0, back: 0, paid: 0, unpaid: 0 },
    ])
  );
  for (const c of consignments) {
    const key = monthKeyVn(c.get('createdAt'));
    const bucket = byMonth.get(key);
    if (!bucket) continue; // phòng hờ lệch tháng ngoài range do giờ biên
    const agg = aggregatesByConsignment.get(c.id);
    bucket.count++;
    bucket.qty += agg.numberOfProducts;
    bucket.sold += agg.sold;
    bucket.total += toVnd(agg.totalMoney);
    const back = toVnd(agg.moneyBack);
    bucket.back += back;
    if (c.get('isGetMoney')) bucket.paid += back;
    else bucket.unpaid += back;
  }

  months.forEach(key => {
    const b = byMonth.get(key);
    const row = wsSummary.addRow([
      monthLabelVn(key),
      b.count,
      b.qty,
      b.sold,
      b.total,
      b.back,
      b.paid,
      b.unpaid,
    ]);
    [5, 6, 7, 8].forEach(col => {
      row.getCell(col).numFmt = MONEY_FMT;
    });
  });

  const summaryWidths = [32, 18, 14, 14, 20, 20, 16, 16];
  summaryWidths.forEach((w, i) => {
    wsSummary.getColumn(i + 1).width = w;
  });

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  await wb.xlsx.writeFile(OUT_PATH);

  console.log(`\n✓ Đã xuất báo cáo: ${OUT_PATH}`);
  console.log(
    `  - ${consignments.length} đơn ký gửi, ${products.length} sản phẩm`
  );
  console.log(
    `  - Tổng giá trị ký gửi: ${totalMoneyAll.toLocaleString('vi-VN')} đ`
  );
  console.log(
    `  - Tổng tiền phải trả KH: ${moneyBackAll.toLocaleString('vi-VN')} đ ` +
      `(đã trả: ${moneyBackPaid.toLocaleString('vi-VN')} đ, chưa trả: ${moneyBackUnpaid.toLocaleString('vi-VN')} đ)`
  );
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\nLỗi:', (err && err.message) || err);
    process.exit(1);
  });
