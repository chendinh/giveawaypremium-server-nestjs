import axios from 'axios';
import * as schedule from 'node-schedule';
import { parseServerConfig } from '../../config/parse.config';
import { scheduleSettings } from '../../config/schedule.config';

export const jobScheduleActiveCampaign = schedule.scheduleJob(
  scheduleSettings.ACTIVE_CAMPAIN,
  function () {
    axios
      .post(
        `${parseServerConfig.serverURL}/jobs/ActiveCampaign`,
        {},
        {
          headers: {
            'X-Parse-Application-Id': parseServerConfig.appId,
            'X-Parse-Master-Key': parseServerConfig.masterKey,
          },
        },
      )
      .then(httpResponse =>
        console.log(
          `[Request] [Jobs] ActiveCampaign success: ${JSON.stringify(httpResponse.data)}`
        )
      )
      .catch(error =>
        console.error(
          `[Request] [Jobs] ActiveCampaign failed ${error.response?.status ?? ''} ${error.message}`
        )
      );
  }
);
