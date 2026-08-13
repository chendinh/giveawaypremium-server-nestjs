import { scheduleSettings } from '../../config/schedule.config';
import { Campaign } from '../../models/campaign';
import {
  jobScheduleActiveCampaign,
  jobScheduleExpireCampaign,
} from '../schedule';

const beforeSave = async (request: Parse.Cloud.BeforeSaveRequest<Campaign>) => {
  try {
    const campaign = request.object;
    if (campaign.isNew()) {
      request.context.isNew = true;
      jobScheduleActiveCampaign.reschedule(scheduleSettings.ACTIVE_CAMPAIN);
    }
    if (campaign.dirty('status')) {
      request.context.dirtyStatus = true;
      // Khi có campaign chuyển ACTIVE → đảm bảo expire job đang chạy
      if (campaign.get('status') === 'ACTIVE') {
        jobScheduleExpireCampaign.reschedule(scheduleSettings.EXPIRE_CAMPAIN);
      }
    }
  } catch (error) {
    throw error;
  }
};

export { beforeSave };
