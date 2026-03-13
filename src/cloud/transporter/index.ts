import { GHTKSTATUS } from '../../constants/order-status';
import { Transporter } from '../../models/transporter';

const afterCreate = async (request: Parse.Cloud.AfterSaveRequest<Transporter>) => {
  const transporter = request.object;
  const order = transporter.get('order');
  order.save({ transporter: transporter.toPointer() }, { useMasterKey: true });
}

const beforeCreate = async(request: Parse.Cloud.BeforeSaveRequest<Transporter>) => {
  const tran = request.object;
  const res = tran.get('res');
  const status: number = res.order?.status ?? 0;
  tran.set('status', GHTKSTATUS[status.toString()] ?? '');

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
