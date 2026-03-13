import moment from 'moment';
import { Campaign, CampaignStatusEnums } from "../../../models/campaign";
import { jobScheduleActiveCampaign } from '../../schedule';

const activeCampaign = async (request) => {
  const query = new Parse.Query(Campaign);
  const nextCampainQuery = new Parse.Query(Campaign);
  const now = moment();
  
  const campaigns = await query
    .equalTo('status', CampaignStatusEnums.PENDING)
    .lessThanOrEqualTo('publicAt', now.toDate())
    .findAll();

  const nextCampaign = await nextCampainQuery
    .equalTo('status', CampaignStatusEnums.PENDING)
    .greaterThan('publicAt', now.toDate())
    .first();
  
  if (!nextCampaign) jobScheduleActiveCampaign.cancel();
  campaigns.forEach(campaign => campaign.save(
    { status: CampaignStatusEnums.ACTIVE },
    { useMasterKey: true }
  ));
};

export {
  activeCampaign
}
