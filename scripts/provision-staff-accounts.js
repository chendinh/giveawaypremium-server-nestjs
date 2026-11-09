/**
 * One-off script: cấp tài khoản nhân sự theo từng người và khoá MỌI tài khoản cũ.
 *
 *   - Tạo mới: khang_admin (administrator), manager_linh (manager),
 *     operator_tien, operator_tran (operator).
 *   - Khoá toàn bộ tài khoản nhân sự đang có (role administrator / operator),
 *     kể cả admin_khang: role -> 'disabled' (lưu role cũ ở `previousRole`), đặt
 *     mật khẩu ngẫu nhiên không ai biết, xoá toàn bộ phiên đăng nhập đang mở.
 *     KHÔNG xoá cứng: đơn hàng và ký gửi trỏ tới các user này (Order.consignee,
 *     tên nhân viên trong báo cáo), xoá cứng sẽ mất người thực hiện.
 *     Hoàn tác = đặt lại role từ `previousRole` + đặt mật khẩu mới (Parse Dashboard).
 *
 * Thứ tự an toàn: tạo tài khoản mới -> đăng nhập thử TẤT CẢ -> chỉ khi đều đạt
 * mới khoá tài khoản cũ (tránh khoá hết admin mà tài khoản mới không dùng được).
 *
 * Yêu cầu: server đã deploy bản có vai trò `manager` và `disabled`
 * (src/constants/user-roles.ts). Script tự kiểm tra trước khi ghi.
 *
 * Mật khẩu chỉ in ra MỘT lần ở cuối, không ghi vào file nào.
 *
 * Usage:
 *   node scripts/provision-staff-accounts.js            # chạy thử, chưa ghi gì
 *   node scripts/provision-staff-accounts.js --apply    # áp dụng
 */
const crypto = require('crypto');
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
const SERVER_URL = process.env.SERVER_URL;

const NEW_ACCOUNTS = [
  { username: 'khang_admin', fullName: 'Khang', role: 'administrator' },
  { username: 'manager_linh', fullName: 'Linh', role: 'manager' },
  { username: 'operator_tien', fullName: 'Tiên', role: 'operator' },
  { username: 'operator_tran', fullName: 'Trân', role: 'operator' },
];
const STAFF_ROLES = ['administrator', 'operator', 'manager'];

// ── Mật khẩu ngẫu nhiên nhưng dễ đọc, dễ nhớ: 3 cụm 2 âm tiết + 4 số ──
// Phụ âm bỏ 'l', nguyên âm giữ a e i o u, số chỉ 2-9: không lẫn l/1, o/0.
// ~48 bit entropy (6 âm tiết × log2(65) + 4 số × log2(8)).
const CONSONANTS = 'bdghkmnprstvx'.split('');
const VOWELS = 'aeiou'.split('');
const pick = list => list[crypto.randomInt(list.length)];
const syllable = () => pick(CONSONANTS) + pick(VOWELS);
const memorablePassword = () => {
  const groups = Array.from({ length: 3 }, () => syllable() + syllable());
  groups[0] = groups[0][0].toUpperCase() + groups[0].slice(1);
  const digits = Array.from({ length: 4 }, () => 2 + crypto.randomInt(8)).join(
    ''
  );
  return `${groups.join('-')}-${digits}`;
};
// Mật khẩu vứt đi cho tài khoản bị khoá: không in, không lưu
const throwawayPassword = () => crypto.randomBytes(32).toString('base64url');

const pointer = id => {
  const o = new Parse.User();
  o.id = id;
  return o;
};

async function sessionsOf(userId) {
  return new Parse.Query('_Session')
    .equalTo('user', pointer(userId))
    .limit(1000)
    .find(MK);
}
async function revokeSessions(userId) {
  let removed = 0;
  for (;;) {
    const batch = await sessionsOf(userId);
    if (batch.length === 0) return removed;
    await Parse.Object.destroyAll(batch, MK);
    removed += batch.length;
  }
}

/**
 * Server đã deploy bản mới chưa? Thử đăng ký như người ngoài (khoá REST công
 * khai, KHÔNG dùng Master Key vì Parse bỏ qua bộ kiểm tra vai trò với Master Key)
 * bằng username đã tồn tại nên chắc chắn không tạo gì:
 *   - bản cũ : vai trò 'manager'/'disabled' chưa có trong danh sách  -> lỗi 142
 *   - bản mới: người ngoài bị chặn tạo vai trò nhân sự             -> lỗi 119
 * (bản cũ với 'administrator' lại lọt qua tới bước trùng tên -> lỗi 202, tức là
 * người ngoài tự tạo được admin; bản mới phải trả 119 cho cả vai trò này.)
 */
async function probeSignup(role, existingUsername) {
  const res = await fetch(`${SERVER_URL}/users`, {
    method: 'POST',
    headers: {
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-REST-API-Key': process.env.REST_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: existingUsername,
      password: throwawayPassword(),
      role,
    }),
  });
  const body = await res.json();
  if (![119, 142, 202].includes(body.code)) {
    throw new Error(
      `Phản hồi không lường trước khi thử vai trò ${role}: ${JSON.stringify(body)}`
    );
  }
  return body.code;
}

async function main() {
  Parse.initialize(process.env.APP_ID, undefined, process.env.MASTER_KEY);
  Parse.serverURL = SERVER_URL;

  // ── 1) Hiện trạng ──
  // Chụp danh sách TRƯỚC khi tạo tài khoản mới: đây chính là tập sẽ bị khoá.
  const toLock = await new Parse.Query(Parse.User)
    .containedIn('role', STAFF_ROLES)
    .limit(200)
    .find(MK);
  if (toLock.length === 0) {
    throw new Error('Không thấy tài khoản nhân sự nào để thay. Dừng.');
  }
  const existingNew = await new Parse.Query(Parse.User)
    .containedIn(
      'username',
      NEW_ACCOUNTS.map(a => a.username)
    )
    .find(MK);
  if (existingNew.length) {
    throw new Error(
      `Username đã tồn tại: ${existingNew.map(u => u.get('username')).join(', ')}. Dừng.`
    );
  }

  console.log('Tạo mới :');
  NEW_ACCOUNTS.forEach(a =>
    console.log(
      `   ${a.username.padEnd(15)} ${a.role.padEnd(14)} "${a.fullName}"`
    )
  );
  console.log(`Khoá (${toLock.length}), không xoá cứng :`);
  for (const u of toLock) {
    const n = (await sessionsOf(u.id)).length;
    console.log(
      `   ${String(u.get('username')).padEnd(15)} ${String(u.get('role')).padEnd(14)} "${u.get('fullName')}"  phiên đang mở: ${n}`
    );
  }

  // ── 2) Server đã deploy bản mới chưa ──
  const existingUsername = toLock[0].get('username');
  const probes = {};
  for (const role of ['administrator', 'manager', 'disabled']) {
    probes[role] = await probeSignup(role, existingUsername);
  }
  const deployed = Object.values(probes).every(code => code === 119);
  console.log(
    `\nThử đăng ký ẩn danh với username có sẵn (mã lỗi): administrator=${probes.administrator}, manager=${probes.manager}, disabled=${probes.disabled}`
  );
  console.log(
    deployed
      ? 'Server đã deploy bản mới (người ngoài bị chặn tạo vai trò nhân sự).'
      : 'Server CHƯA deploy bản mới (cần cả ba mã là 119).'
  );
  if (!deployed) {
    console.log('=> Deploy server rồi chạy lại.');
    if (APPLY) process.exitCode = 1;
    return;
  }
  if (!APPLY) {
    console.log('\n(CHẠY THỬ) Chưa ghi gì. Chạy lại với --apply để áp dụng.');
    return;
  }

  // ── 3) Tạo tài khoản mới ──
  const credentials = [];
  for (const acc of NEW_ACCOUNTS) {
    const password = memorablePassword();
    const user = new Parse.User();
    user.set('username', acc.username);
    user.set('password', password);
    user.set('fullName', acc.fullName);
    user.set('role', acc.role);
    await user.save(null, MK);
    await revokeSessions(user.id); // nếu lúc tạo có sinh phiên thì bỏ
    credentials.push({ ...acc, password, id: user.id });
    console.log(`Đã tạo ${acc.username} (${user.id})`);
  }

  // ── 4) Đăng nhập thử TẤT CẢ tài khoản mới; có lỗi thì dừng, chưa khoá gì ──
  console.log('\n== Đăng nhập thử tài khoản mới');
  let loginFailures = 0;
  for (const c of credentials) {
    const res = await fetch(
      `${SERVER_URL}/login?username=${encodeURIComponent(c.username)}&password=${encodeURIComponent(c.password)}`,
      {
        headers: {
          'X-Parse-Application-Id': process.env.APP_ID,
          'X-Parse-REST-API-Key': process.env.REST_API_KEY,
        },
      }
    );
    const body = await res.json();
    const ok = res.ok && body.role === c.role && !!body.sessionToken;
    if (!ok) loginFailures++;
    console.log(
      `${ok ? 'OK ' : 'LỖI'} ${c.username} -> vai trò ${body.role || JSON.stringify(body)}`
    );
    await revokeSessions(c.id); // bỏ phiên đăng nhập thử
  }
  if (loginFailures) {
    console.error(
      `\n${loginFailures} tài khoản mới đăng nhập thử lỗi. CHƯA khoá tài khoản cũ, chưa in mật khẩu. Kiểm tra các tài khoản vừa tạo trong Parse Dashboard.`
    );
    process.exitCode = 1;
    return;
  }

  // ── 5) Khoá tài khoản cũ ──
  console.log('\n== Khoá tài khoản cũ');
  for (const u of toLock) {
    const previousRole = u.get('role');
    u.set('previousRole', previousRole);
    u.set('disabledAt', new Date());
    u.set('role', 'disabled');
    u.set('password', throwawayPassword());
    await u.save(null, MK);
    const removed = await revokeSessions(u.id);
    console.log(
      `Đã khoá ${u.get('username')} (${previousRole}), xoá ${removed} phiên`
    );
  }

  // ── 6) Xác minh khoá ──
  console.log('\n== Xác minh');
  let failures = 0;
  for (const u of toLock) {
    const now = await new Parse.Query(Parse.User).get(u.id, MK);
    const left = (await sessionsOf(u.id)).length;
    const ok = now.get('role') === 'disabled' && left === 0;
    if (!ok) failures++;
    console.log(
      `${ok ? 'OK ' : 'LỖI'} ${now.get('username')}: role=${now.get('role')}, phiên còn lại=${left}`
    );
  }
  const activeAdmins = await new Parse.Query(Parse.User)
    .equalTo('role', 'administrator')
    .find(MK);
  const adminOk =
    activeAdmins.length === 1 &&
    activeAdmins[0].get('username') === 'khang_admin';
  if (!adminOk) failures++;
  console.log(
    `${adminOk ? 'OK ' : 'LỖI'} administrator còn hoạt động: ${activeAdmins.map(u => u.get('username')).join(', ') || '(không có)'}`
  );

  // ── 7) In mật khẩu một lần ──
  console.log('\n== TÀI KHOẢN MỚI (mật khẩu chỉ hiện một lần, không được lưu)');
  console.log('username'.padEnd(16) + 'vai trò'.padEnd(15) + 'mật khẩu');
  credentials.forEach(c =>
    console.log(c.username.padEnd(16) + c.role.padEnd(15) + c.password)
  );
  if (failures) {
    console.error(
      `\nCó ${failures} bước xác minh lỗi. Kiểm tra lại trước khi giao mật khẩu.`
    );
    process.exitCode = 1;
  }
}

main().then(
  () => process.exit(process.exitCode || 0),
  e => {
    console.error('Lỗi:', e.message || e);
    process.exit(1);
  }
);
