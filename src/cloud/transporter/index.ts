import { getStatusByService } from '../../common/transporter.utils';
import { Transporter } from '../../models/transporter';

const afterCreate = async (
  request: Parse.Cloud.AfterSaveRequest<Transporter>
) => {
  const transporter = request.object;
  const order = transporter.get('order');
  order.save({ transporter: transporter.toPointer() }, { useMasterKey: true });
};

const beforeCreate = async (
  request: Parse.Cloud.BeforeSaveRequest<Transporter>
) => {
  const tran = request.object;
  const res = tran.get('res');
  const service = tran.get('service') || 'giaohangtietkiem';

  let statusCode: number;
  switch (service) {
    case 'viettelpost':
      // Khi mới tạo đơn VTP, response createOrder KHÔNG có ORDER_STATUS
      // ORDER_STATUS chỉ đến từ webhook sau khi VTP xử lý
      // → Status ban đầu luôn là WAITING_PICK_UP (102)
      statusCode = res?.data?.ORDER_STATUS ?? 102;
      break;
    case 'giaohangtietkiem':
    default:
      statusCode = res?.order?.status ?? 0;
      break;
  }
  tran.set('status', getStatusByService(service, statusCode));
};

const beforeSave = async (
  request: Parse.Cloud.BeforeSaveRequest<Transporter>
) => {
  try {
    const product = request.object;

    if (product.isNew()) {
      beforeCreate(request);
      request.context.isNew = true;
    }
  } catch (error) {
    throw error;
  }
};

const afterSave = async (
  request: Parse.Cloud.AfterSaveRequest<Transporter>
) => {
  const context = request.context;

  if (context.isNew) afterCreate(request);
};

export { beforeSave, afterSave };
