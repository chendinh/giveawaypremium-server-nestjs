import * as schedule from 'node-schedule';
import { scheduleSettings } from '../../config/schedule.config';
import { activeCampaign } from '../job/campaign';
import { expireCampaign } from '../job/campaign/expire';

export const jobScheduleActiveCampaign = schedule.scheduleJob(
  scheduleSettings.ACTIVE_CAMPAIN,
  function () {
    activeCampaign({})
      .then(() => console.log('[Jobs] ActiveCampaign success'))
      .catch(error =>
        console.error(
          `[Jobs] ActiveCampaign failed: ${error?.message || error}`
        )
      );
  }
);

export const jobScheduleExpireCampaign = schedule.scheduleJob(
  scheduleSettings.EXPIRE_CAMPAIN,
  function () {
    expireCampaign({})
      .then(() => console.log('[Jobs] ExpireCampaign success'))
      .catch(error =>
        console.error(
          `[Jobs] ExpireCampaign failed: ${error?.message || error}`
        )
      );
  }
);
