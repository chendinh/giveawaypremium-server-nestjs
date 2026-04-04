import { GHTKSTATUS, VIETTELPOST_STATUS } from '../../constants/order-status';
import { Transporter } from '../../models/transporter';

const getStatusByService = (service: string, statusCode: number | string): string => {
  const code = statusCode.toString();
  switch (service) {
    case 'giaohangtietkiem':
      return GHTKSTATUS[code] ?? '';
    case 'viettelpost':
      return VIETTELPOST_STATUS[code] ?? '';
    default:
      return '';
  }
}

const afterCreate = async (request: Parse.Cloud.AfterSaveRequest<Transporter>) => {
  const transporter = request.object;
  const order = transporter.get('order');
  order.save({ transporter: transporter.toPointer() }, { useMasterKey: true });
}

const beforeCreate = async(request: Parse.Cloud.BeforeSaveRequest<Transporter>) => {
  const tran = request.object;
  const res = tran.get('res');
  const service = tran.get('service') || 'giaohangtietkiem';

  let statusCode: number;
  switch (service) {
    case 'viettelpost':
      statusCode = res?.data?.ORDER_STATUS ?? res?.status ?? 0;
      break;
    case 'giaohangtietkiem':
    default:
      statusCode = res?.order?.status ?? 0;
      break;
  }
  tran.set('status', getStatusByService(service, statusCode));
}

const beforeSave = async(request: Parse.Cloud.BeforeSaveRequest<Transporter>) => {
  try {
    const product = request.object;

    if (product.isNew()) {
      beforeCreate(request);
      request.context.isNew = true ;
    }
  } catch (error) {
    throw error;
  }
};

const afterSave = async (request: Parse.Cloud.AfterSaveRequest<Transporter>) => {
  const context = request.context;

  if (context.isNew) afterCreate(request);
}

export {
  beforeSave,
  afterSave,
};
