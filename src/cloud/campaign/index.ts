import { scheduleSettings } from "../../config/schedule.config";
import { 
  Campaign,
} from "../../models/campaign";
import { jobScheduleActiveCampaign } from '../schedule';

const beforeSave = async (request: Parse.Cloud.BeforeSaveRequest<Campaign>) => {
  try {
    const campaign = request.object;
    if (campaign.isNew()) {
      request.context.isNew = true ;
      jobScheduleActiveCampaign.reschedule(scheduleSettings.ACTIVE_CAMPAIN);
    }
    if (campaign.dirty('status')) {
      request.context.dirtyStatus = true;
    }

  } catch (error) {
    throw error;
  }
};

export {
  beforeSave,
};
