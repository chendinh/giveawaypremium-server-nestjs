import { NhanhHookService } from "../../external-services/nhanh/nhanh.hooks";
import { nhanhConfigs } from "../../config/nhanh.config";

const beforeSave = async (request: Parse.Cloud.BeforeSaveRequest) => {
  const externalConfig = request.object;

  if (externalConfig.get('type') === 'NHANH_HOOK_CONFIG') {
    const data = externalConfig.get('data') || {};
    const nhanhHookService = new NhanhHookService(nhanhConfigs);
    nhanhHookService.updateHook(data).then(response => {
      externalConfig.set('response', response);
    }).catch((err) => {
      externalConfig.set('err', err);
    });
    ;
  }
};

export {
  beforeSave
}
