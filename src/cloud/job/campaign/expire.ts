import moment from 'moment';
import { Campaign, CampaignStatusEnums } from '../../../models/campaign';

/**
 * Parse Job: ExpireCampaign
 *
 * Chạy định kỳ (mỗi phút) — tìm tất cả Campaign ACTIVE đã qua endDate
 * và chuyển về EXPIRED.
 *
 * Lưu ý:
 * - Campaign không bắt buộc có endDate — nếu không có thì không expire
 * - Không xóa campaign, chỉ đổi status
 */
export const expireCampaign = async (_request: any) => {
  const now = moment();

  const query = new Parse.Query(Campaign);
  query.equalTo('status', CampaignStatusEnums.ACTIVE);
  query.exists('endDate');
  query.lessThanOrEqualTo('endDate', now.toDate());

  const campaigns = await query.findAll({ useMasterKey: true });

  if (!campaigns.length) return;

  const promises = campaigns.map(campaign =>
    campaign.save(
      { status: CampaignStatusEnums.EXPIRED },
      { useMasterKey: true }
    )
  );

  await Promise.all(promises);

  console.log(`[ExpireCampaign] Expired ${campaigns.length} campaign(s)`);
};
