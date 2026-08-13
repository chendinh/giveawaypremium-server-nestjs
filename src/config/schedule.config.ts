export const scheduleSettings = {
  ACTIVE_CAMPAIN: process.env.ACTIVE_CAMPAIN_SCHEDULE || '0 * * * * *',
  EXPIRE_CAMPAIN: process.env.EXPIRE_CAMPAIN_SCHEDULE || '0 * * * * *',
};
