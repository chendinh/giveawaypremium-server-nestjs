import * as schedule from 'node-schedule';
import { parseServerConfig } from '../../config/parse.config';
import { scheduleSettings } from '../../config/schedule.config';

export const jobScheduleActiveCampaign = schedule.scheduleJob(
  scheduleSettings.ACTIVE_CAMPAIN, 
  function() {
    Parse.Cloud.httpRequest({
      url: `${parseServerConfig.serverURL}/jobs/ActiveCampaign`,
      method: 'post',
      headers: {
        'X-Parse-Application-Id': parseServerConfig.appId,
        'X-Parse-Master-Key': parseServerConfig.masterKey,
      }
    })
    .then(httpResponse => console.log(`[Request] [Jobs] ActiveCampaign success: ${httpResponse.text}`))
    .catch(httpResponse => console.error(
      `[Request] [Jobs] ActiveCampaign failed ${httpResponse.status} ${httpResponse}`)
    );
  }
);
