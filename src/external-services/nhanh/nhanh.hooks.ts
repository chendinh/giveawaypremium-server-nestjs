import { NhanhServiceOptions } from "./interface";
import { NhanhServiceImpl } from "./nhanh.service";

interface NhanhHook {
  updateHook(request: object): Promise<any>;
}

export class NhanhHookService extends NhanhServiceImpl implements NhanhHook {
  static hookUpdateUrl = '/api/store/configwebhooks';
  constructor(options: NhanhServiceOptions) {
    super(options);
  }

  public async updateHook(request: object): Promise<any> {
    try {
      const result = await this.request(
        NhanhHookService.hookUpdateUrl, 
        request,
      );
      return result;
    } catch (error) {
      throw error;
    }
  }
}
