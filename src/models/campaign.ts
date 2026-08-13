export enum CampaignStatusEnums {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
}

export class Campaign extends Parse.Object {
  constructor() {
    super('Campaign');
  }
}
