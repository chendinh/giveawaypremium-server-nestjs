/**
 * ViettelPost Token Persistence Service
 *
 * Token được lưu vào Parse DB (ExternalConfig class) để tồn tại qua restart.
 * Key trong DB: 'VIETTELPOST_LONG_TOKEN'
 *
 * Luồng:
 *   Server start → loadTokenFromDB() → nếu có token trong DB thì dùng
 *               → nếu không có → dùng VIETTELPOST_TOKEN từ env
 *               → nếu hết hạn → tự động re-login + lấy long token mới → lưu lại DB
 */

import logger from '../../plugins/logger';
import { ViettelPost } from './viettelpost';

const EXTERNAL_CONFIG_KEY = 'VIETTELPOST_LONG_TOKEN';

/**
 * Lưu long token vào Parse DB (ExternalConfig)
 */
export const saveTokenToDB = async (token: string): Promise<void> => {
  try {
    const query = new Parse.Query('ExternalConfig');
    query.equalTo('key', EXTERNAL_CONFIG_KEY);
    const existing = await query.first({ useMasterKey: true });

    if (existing) {
      existing.set('value', token);
      await existing.save(undefined, { useMasterKey: true });
    } else {
      const config = new Parse.Object('ExternalConfig');
      config.set('key', EXTERNAL_CONFIG_KEY);
      config.set('value', token);
      // Schema ExternalConfig yêu cầu 'type' và 'data' là required fields
      config.set('type', 'VIETTELPOST_TOKEN');
      config.set('data', {});
      await config.save(undefined, { useMasterKey: true });
    }
    logger.info('[VTP Token] Long token saved to DB');
  } catch (err) {
    logger.error('[VTP Token] Failed to save token to DB:', err);
  }
};

/**
 * Load long token từ Parse DB
 * Trả về null nếu không tìm thấy
 */
export const loadTokenFromDB = async (): Promise<string | null> => {
  try {
    const query = new Parse.Query('ExternalConfig');
    query.equalTo('key', EXTERNAL_CONFIG_KEY);
    // first() trả về undefined nếu không tìm thấy — không throw
    const config = await query.first({ useMasterKey: true });
    if (!config) return null;
    const token = config.get('value') ?? null;
    if (token) {
      logger.info('[VTP Token] Long token loaded from DB');
    }
    return token;
  } catch (err) {
    // Không throw — chỉ log và fallback
    logger.warn(
      '[VTP Token] Could not load token from DB (may not exist yet):',
      err?.message || err
    );
    return null;
  }
};

/**
 * Khởi tạo token khi server start:
 * 1. Thử load từ DB
 * 2. Nếu không có → login() + getLongToken() → lưu vào DB
 * 3. Set vào cachedToken của ViettelPost class
 */
export const initViettelPostToken = async (): Promise<void> => {
  try {
    // 1. Thử load từ DB trước
    const dbToken = await loadTokenFromDB();
    if (dbToken) {
      ViettelPost.setToken(dbToken);
      logger.info('[VTP Token] Initialized from DB');
      return;
    }

    // 2. Không có trong DB → thử login lấy token mới
    const username = process.env.VIETTELPOST_USERNAME;
    const password = process.env.VIETTELPOST_PASSWORD;

    if (!username || !password) {
      // Chỉ dùng token từ env, không tự login
      const envToken = process.env.VIETTELPOST_TOKEN;
      if (envToken) {
        ViettelPost.setToken(envToken);
        logger.info('[VTP Token] Using VIETTELPOST_TOKEN from env');
      } else {
        logger.warn(
          '[VTP Token] No token available — set VIETTELPOST_TOKEN or USERNAME/PASSWORD in .env'
        );
      }
      return;
    }

    logger.info('[VTP Token] No token in DB, attempting auto-login...');
    const vtp = new ViettelPost({});
    const loginResult = await vtp.login(username, password);

    if (!loginResult.token) {
      logger.error('[VTP Token] Login failed, falling back to env token');
      const envToken = process.env.VIETTELPOST_TOKEN;
      if (envToken) ViettelPost.setToken(envToken);
      return;
    }

    // 3. Đổi lấy long token
    const longResult = await vtp.getLongToken(loginResult.token);
    if (longResult.token) {
      ViettelPost.setToken(longResult.token);
      await saveTokenToDB(longResult.token);
      logger.info('[VTP Token] Auto-login success, long token saved to DB');
    } else {
      // Fallback về short token
      ViettelPost.setToken(loginResult.token);
      logger.warn('[VTP Token] getLongToken failed, using short token');
    }
  } catch (err) {
    logger.error('[VTP Token] initViettelPostToken error:', err);
    // Cuối cùng fallback về env token
    const envToken = process.env.VIETTELPOST_TOKEN;
    if (envToken) ViettelPost.setToken(envToken);
  }
};
