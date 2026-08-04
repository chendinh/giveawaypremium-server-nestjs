/**
 * ViettelPost Address Lookup Cloud Functions
 *
 * VTP dùng numeric ID (PROVINCE_ID, DISTRICT_ID, WARDS_ID).
 * Các functions này fetch từ VTP API và cache trong ExternalConfig
 * để tránh gọi VTP liên tục.
 *
 * Cache TTL: 7 ngày (địa danh không thay đổi thường xuyên)
 */

import fetch from 'node-fetch';
import { viettelpostConfigs } from '../../config/viettelpost.config';
import { ViettelPost } from '../../external-services/transporter/viettelpost';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

const getCachedOrFetch = async (
  cacheKey: string,
  fetchFn: () => Promise<any[]>
): Promise<any[]> => {
  // Thử load từ cache (ExternalConfig)
  try {
    const query = new Parse.Query('ExternalConfig');
    query.equalTo('key', cacheKey);
    const cached = await query.first({ useMasterKey: true });

    if (cached) {
      const cachedAt = new Date(cached.get('cachedAt') || 0).getTime();
      if (Date.now() - cachedAt < CACHE_TTL_MS) {
        return cached.get('value') || [];
      }
    }

    // Cache miss hoặc expired → fetch từ VTP
    const data = await fetchFn();

    // Upsert cache
    const configObj = cached || new Parse.Object('ExternalConfig');
    await configObj.save(
      { key: cacheKey, value: data, cachedAt: new Date().toISOString() },
      { useMasterKey: true }
    );

    return data;
  } catch (err) {
    console.error(
      `[VTP Address] getCachedOrFetch error for ${cacheKey}:`,
      err?.message
    );
    // Fallback: fetch trực tiếp không cache
    return fetchFn().catch(() => []);
  }
};

const getToken = (): string => ViettelPost.getStoredToken();

/**
 * Lấy danh sách tỉnh/TP từ VTP
 * Trả về: [{ PROVINCE_ID, PROVINCE_CODE, PROVINCE_NAME }]
 */
export const getVtpProvinces = async (
  request: Parse.Cloud.FunctionRequest
): Promise<any[]> => {
  return getCachedOrFetch('VTP_PROVINCES', async () => {
    const res = await fetch(
      `${viettelpostConfigs.viettelpostUrl}/categories/listProvinceById?provinceId=-1`,
      { headers: { Token: getToken() } }
    );
    const json: any = await res.json();
    // Response là array hoặc { status, data: array }
    if (Array.isArray(json)) return json;
    return json?.data || [];
  });
};

/**
 * Lấy danh sách quận/huyện theo tỉnh
 * Params: { provinceId: number }
 * Trả về: [{ DISTRICT_ID, DISTRICT_NAME, PROVINCE_ID }]
 */
export const getVtpDistricts = async (
  request: Parse.Cloud.FunctionRequest
): Promise<any[]> => {
  const { provinceId } = request.params;
  if (!provinceId)
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'provinceId required');

  const cacheKey = `VTP_DISTRICTS_${provinceId}`;
  return getCachedOrFetch(cacheKey, async () => {
    const res = await fetch(
      `${viettelpostConfigs.viettelpostUrl}/categories/listDistrict?provinceId=${provinceId}`,
      { headers: { Token: getToken() } }
    );
    const json: any = await res.json();
    if (Array.isArray(json)) return json;
    return json?.data || [];
  });
};

/**
 * Lấy danh sách phường/xã theo quận
 * Params: { districtId: number }
 * Trả về: [{ WARDS_ID, WARDS_NAME, DISTRICT_ID }]
 */
export const getVtpWards = async (
  request: Parse.Cloud.FunctionRequest
): Promise<any[]> => {
  const { districtId } = request.params;
  if (!districtId)
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'districtId required');

  const cacheKey = `VTP_WARDS_${districtId}`;
  return getCachedOrFetch(cacheKey, async () => {
    const res = await fetch(
      `${viettelpostConfigs.viettelpostUrl}/categories/listWards?districtId=${districtId}`,
      { headers: { Token: getToken() } }
    );
    const json: any = await res.json();
    if (Array.isArray(json)) return json;
    return json?.data || [];
  });
};

/**
 * Lookup VTP IDs từ tên string (dùng khi không có ID)
 * Params: { provinceName, districtName, wardName }
 * Trả về: { provinceId, districtId, wardId } hoặc null nếu không tìm thấy
 *
 * Dùng cho: SaleScreen khi user chọn địa chỉ từ unitAddressRedux (tên string)
 */
export const lookupVtpAddressIds = async (
  request: Parse.Cloud.FunctionRequest
): Promise<{
  provinceId: number | null;
  districtId: number | null;
  wardId: number | null;
  found: boolean;
}> => {
  const { provinceName, districtName, wardName } = request.params;

  const normalize = (s: string) =>
    s
      ?.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || '';

  // Word-boundary match — tránh "quận 1" khớp nhầm "quận 10"
  const isMatch = (vtpName: string, searchName: string): boolean => {
    const n1 = normalize(vtpName);
    const n2 = normalize(searchName);
    if (n1 === n2) return true;
    // Thêm space cuối để "quan 1" không match "quan 10"
    if ((n1 + ' ').startsWith(n2 + ' ') || (n2 + ' ').startsWith(n1 + ' '))
      return true;
    // includes chỉ dùng khi chuỗi đủ dài (>= 5 ký tự)
    if (
      n1.length >= 5 &&
      n2.length >= 5 &&
      (n1.includes(n2) || n2.includes(n1))
    )
      return true;
    // Xử lý số quận/phường thuần: unitAddressRedux lưu "1", "12", "Gò Vấp"
    // VTP trả về "Quận 1", "Quận 12", "Quận Gò Vấp", "Phường 1", "Phường 02"
    // → bóc số/tên sau prefix "quan", "phuong", "huyen", "thi xa", "xa"
    const stripPrefix = (s: string) =>
      s
        .replace(/^(quan|phuong|huyen|thi tran|thi xa|xa|thanh pho|tp)\s+/, '')
        .replace(/^0+/, '') // bỏ leading zero: "02" → "2"
        .trim();
    const s1 = stripPrefix(n1);
    const s2 = stripPrefix(n2);
    if (s1 && s2 && (s1 + ' ').startsWith(s2 + ' ')) return true;
    return false;
  };

  // 1. Tìm tỉnh
  const provinces = await getVtpProvinces(request);
  const province = provinces.find(p => isMatch(p.PROVINCE_NAME, provinceName));
  if (!province) {
    console.warn(`[VTP Lookup] Province not found: "${provinceName}"`);
    return { provinceId: null, districtId: null, wardId: null, found: false };
  }

  // 2. Tìm quận/huyện
  const districts = await getVtpDistricts({
    ...request,
    params: { provinceId: province.PROVINCE_ID },
  } as any);

  const district = districts.find(d => isMatch(d.DISTRICT_NAME, districtName));
  if (!district) {
    console.warn(
      `[VTP Lookup] District not found: "${districtName}" in province ${province.PROVINCE_ID}`
    );
    return {
      provinceId: province.PROVINCE_ID,
      districtId: null,
      wardId: null,
      found: false,
    };
  }

  // 3. Tìm phường/xã
  const wards = await getVtpWards({
    ...request,
    params: { districtId: district.DISTRICT_ID },
  } as any);

  const ward = wards.find(w => isMatch(w.WARDS_NAME, wardName));

  return {
    provinceId: province.PROVINCE_ID,
    districtId: district.DISTRICT_ID,
    wardId: ward?.WARDS_ID ?? null,
    found: !!ward,
  };
};
