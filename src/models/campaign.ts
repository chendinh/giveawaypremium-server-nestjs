export enum CampaignStatusEnums {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
}

export class Campaign extends Parse.Object {
  constructor() {
    super('Campaign');
  }
}
