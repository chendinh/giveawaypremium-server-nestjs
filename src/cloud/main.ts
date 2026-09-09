import * as ejs from 'ejs';
import { MailFactory } from '../external-services/email';
import { MAIL_TYPE } from '../external-services/email/constants';
import { mailConfigs } from '../config/email.config';
import { EMAIL_PATHS, EMAIL_TYPES, USER_ROLES } from '../constants';
import * as ConsignmentCloud from './consignment';
import * as ConsignmentCloudValidate from './consignment/validate';
import * as ExternalConfigCloud from './external-config';
import * as SubCategoryCloud from './sub-category';
import * as ProductCloud from './product';
import * as CampaignCloud from './campaign';
import * as OrderCloud from './order';
import * as CampaignCloudValidate from './campaign/validate';
import * as TransporterCloud from './transporter';
import * as OrderRequestCloud from './order-request';
import * as AppointmentCloud from './appointment';

import { findAll } from './nhanh-category';
import { activeCampaign } from './job/campaign';
import { expireCampaign } from './job/campaign/expire';
import { getAdministativeUnits } from './function/administrative-units';
import { tranporterAction } from './function/transporter';
import { TransporterService } from '../external-services/transporter/interface';
import { requestOrderGuest } from './function/guest-order';
import {
  remiderIndividualConsignment,
  reminderConsignmentGroup,
  sendConsignmentEmail,
  sendPaymentConfirmationEmail,
} from './function/mail';
import { initViettelPostToken } from '../external-services/transporter/viettelpost.token.service';
import {
  getVtpProvinces,
  getVtpDistricts,
  getVtpWards,
  lookupVtpAddressIds,
} from './function/vtp-address';
import { getOrderSummary } from './function/order-summary';
import { updateUserByAdmin } from './function/user';

const USER_CLOUD = {
  beforeCreate: async (
    request: Parse.Cloud.BeforeSaveRequest<Parse.User>
  ): Promise<void> => {
    const object = request.object;
    const roleACL = new Parse.ACL();
    roleACL.setRoleWriteAccess('administrator', true);
    roleACL.setRoleReadAccess('administrator', true);
    roleACL.setPublicReadAccess(true);
    object.setACL(roleACL);
  },
};

Parse.Cloud.beforeSave(
  Parse.User,
  async (request: Parse.Cloud.BeforeSaveRequest<Parse.User>): Promise<void> => {
    const object = request.object;
    if (object.isNew()) await USER_CLOUD.beforeCreate(request);
  },
  {
    fields: {
      role: {
        type: String,
        options: val => {
          return Object.values(USER_ROLES).includes(val);
        },
        error: `role not includes ${Object.values(USER_ROLES)}`,
      },
    },
  }
);

Parse.Cloud.beforeDelete(
  Parse.User,
  async (request: Parse.Cloud.BeforeDeleteRequest<Parse.User>) => {},
  {
    requireMaster: true,
  }
);

// cloud code for Send Email
Parse.Cloud.define<(param: { objectId: string }) => { objectId: string }>(
  'emailRemiderIndividualConsignment',
  remiderIndividualConsignment,
  {
    requireUser: true,
    fields: {
      objectId: {
        required: true,
        type: String,
        options: val => {
          return !!val;
        },
      },
    },
  }
);

Parse.Cloud.define<(param: { groupId: string }) => { groupId: string }>(
  'emailReminderConsignmentGroup',
  reminderConsignmentGroup,
  {
    requireUser: true,
    fields: {
      groupId: {
        required: true,
        type: String,
        options: val => {
          return !!val;
        },
      },
    },
  }
);

Parse.Cloud.define<(param: { consignmentId: string }) => { success: boolean }>(
  'sendConsignmentEmail',
  sendConsignmentEmail,
  {
    requireUser: true,
    fields: {
      consignmentId: {
        required: true,
        type: String,
        options: (val: string) => !!val,
        error: 'consignmentId là bắt buộc và không được rỗng',
      },
    },
  }
);

Parse.Cloud.define<(param: { consignmentId: string }) => { success: boolean }>(
  'sendPaymentConfirmationEmail',
  sendPaymentConfirmationEmail,
  {
    requireUser: true,
    fields: {
      consignmentId: {
        required: true,
        type: String,
        options: (val: string) => !!val,
        error: 'consignmentId là bắt buộc và không được rỗng',
      },
    },
  }
);

Parse.Cloud.define(
  'email',
  async (
    request: Parse.Cloud.FunctionRequest
  ): Promise<{ success: boolean }> => {
    try {
      const { params } = request;
      const type = params.type as string;
      const data = params.data;
      const path = EMAIL_PATHS[type];
      const options = {};
      const htlmStr = await ejs.renderFile(path, data, options);
      const emailFactory = MailFactory.getMail(
        MAIL_TYPE.SENDINBLUE,
        mailConfigs
      );
      emailFactory.send({
        mailTo: params.mailTo,
        title: params.title || 'non-reply', // Subject line
        html: htlmStr,
      });

      return { success: true };
    } catch (error) {
      throw error;
    }
  },
  {
    fields: {
      type: {
        type: String,
        options: val => {
          return Object.values(EMAIL_TYPES).includes(val);
        },
        error: `Type not includes ${Object.values(EMAIL_TYPES)}`,
      },
      mailTo: {
        type: String,
        options: val => {
          const re =
            /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
          return re.test(String(val).toLowerCase());
        },
        error: `email invalid`,
      },
    },
  }
);

// cloud code for Consignment
Parse.Cloud.beforeSave(
  'Consignment',
  ConsignmentCloud.beforeSave,
  ConsignmentCloudValidate.beforeSave
);
Parse.Cloud.afterSave('Consignment', ConsignmentCloud.afterSave);
Parse.Cloud.beforeDelete('Consignment', async request => {}, {
  requireMaster: true,
});
Parse.Cloud.beforeDelete('Role', async request => {}, {
  requireMaster: true,
});
Parse.Cloud.beforeDelete('Agency', async request => {}, {
  requireMaster: true,
});
// AppointmentSchedule — validate slot trước khi insert
Parse.Cloud.beforeSave('AppointmentSchedule', AppointmentCloud.beforeSave);
Parse.Cloud.beforeDelete('AppointmentSchedule', async _request => {}, {
  requireMaster: true,
});
Parse.Cloud.beforeDelete('Category', async request => {}, {
  requireMaster: true,
});
Parse.Cloud.beforeDelete('ConsignmentGroup', async request => {}, {
  requireMaster: true,
});
Parse.Cloud.beforeDelete('Product', async request => {}, {
  requireMaster: true,
});
Parse.Cloud.beforeDelete('SubCategory', async request => {}, {
  requireMaster: true,
});

// cloud code for Product
Parse.Cloud.beforeSave('Product', ProductCloud.beforeSave);
Parse.Cloud.afterSave('Product', ProductCloud.afterSave);

// cloud code Nhanh prouct sync
// Parse.Cloud.define('nhanh-produc-sync', NhanhProductSyncCloud.nhanhProductSync);

// cloud code Nhanh prouct sync
Parse.Cloud.beforeSave('ExternalConfig', ExternalConfigCloud.beforeSave);

// cloud code for Product
Parse.Cloud.beforeSave('SubCategory', SubCategoryCloud.beforeSave);
Parse.Cloud.afterSave('SubCategory', SubCategoryCloud.afterSave);

// cloud code for Product
Parse.Cloud.beforeSave('Order', OrderCloud.beforeSave);
Parse.Cloud.afterSave('Order', OrderCloud.afterSave);
Parse.Cloud.afterFind('Order', OrderCloud.afterFind);

// Cloud function Nhanh Category
Parse.Cloud.define('nhanh-category', findAll);

// cloud code for Product
Parse.Cloud.beforeSave(
  'Campaign',
  CampaignCloud.beforeSave,
  CampaignCloudValidate.beforeSave
);
// Parse.Cloud.afterSave('Campaign', CampaignCloud.afterSave);

// cloud code for TransporterCloud
Parse.Cloud.beforeSave('Transporter', TransporterCloud.beforeSave);
Parse.Cloud.afterSave('Transporter', TransporterCloud.afterSave);

// cloud code for Order Request
Parse.Cloud.beforeSave('OrderRequest', OrderRequestCloud.beforeSave);
Parse.Cloud.afterSave('OrderRequest', OrderRequestCloud.afterSave);
Parse.Cloud.beforeFind('OrderRequest', OrderRequestCloud.beforeFind);

// Define Job
Parse.Cloud.job('ActiveCampaign', activeCampaign);
Parse.Cloud.job('ExpireCampaign', expireCampaign);

// Define Function
Parse.Cloud.define('administativeUnits', getAdministativeUnits);

// ViettelPost address lookup (public — không cần auth, có cache 7 ngày)
Parse.Cloud.define('vtpProvinces', getVtpProvinces);
Parse.Cloud.define('vtpDistricts', getVtpDistricts, {
  fields: { provinceId: { type: Number, required: true } },
});
Parse.Cloud.define('vtpWards', getVtpWards, {
  fields: { districtId: { type: Number, required: true } },
});
Parse.Cloud.define('vtpLookupAddress', lookupVtpAddressIds, {
  fields: {
    provinceName: { type: String, required: true },
    districtName: { type: String, required: true },
    wardName: { type: String, required: true },
  },
});

/**
 * Cloud Function: transporter
 *
 * Phân quyền theo action:
 * - PRICE_ESTIMATE   → public (không cần login) — chỉ đọc giá
 * - CREATE_ORDER     → yêu cầu user đăng nhập — tạo vận đơn thật, tốn phí
 * - CANCEL_ORDER     → yêu cầu user đăng nhập — hủy vận đơn thật
 * - GET_ORDER_LABEL  → yêu cầu user đăng nhập
 * - LOGIN / GET_LONG_TOKEN / LOGIN_BY_SECRET_KEY → chỉ master key (admin)
 */
Parse.Cloud.define('transporter', tranporterAction, {
  fields: {
    service: {
      type: String,
      options: (val: string) => {
        return Object.values(TransporterService).includes(
          val as TransporterService
        );
      },
    },
    action: {
      type: String,
      options: val => {
        return [
          'PRICE_ESTIMATE',
          'GET_SERVICES',
          'CREATE_ORDER',
          'GET_ORDER_LABEL',
          'GET_ORDER_STATUS',
          'CANCEL_ORDER',
          'LOGIN',
          'GET_LONG_TOKEN',
          'LOGIN_BY_SECRET_KEY',
        ].includes(val);
      },
    },
    data: { type: Object },
  },
});

/**
 * Middleware kiểm tra quyền cho các action nhạy cảm.
 * beforeSave không áp dụng cho Cloud Function — dùng beforeFind trigger
 * thay thế bằng check trong tranporterAction (xem cloud/function/transporter.ts)
 */

Parse.Cloud.define<
  (param: { productId: string; count: number }) => {
    productId: string;
    count: number;
  }
>('orderGuest', requestOrderGuest, {
  fields: {
    productId: {
      type: String,
      required: true,
      options: val => !!val,
      error: 'required productId',
    },
    count: {
      type: Number,
      required: true,
      options: val => val > 0,
      error: 'required count greater than 0',
    },
  },
});

// Cloud Function: getOrderSummary — aggregate theo khoảng ngày, requireUser
Parse.Cloud.define('getOrderSummary', getOrderSummary, {
  requireUser: true,
  fields: {
    fromDate: {
      type: String,
      required: true,
      options: (val: string) => !isNaN(Date.parse(val)),
      error: 'fromDate must be a valid ISO date string',
    },
    toDate: {
      type: String,
      required: true,
      options: (val: string) => !isNaN(Date.parse(val)),
      error: 'toDate must be a valid ISO date string',
    },
  },
});

// Cloud Function: updateUserByAdmin — admin cập nhật thông tin user bằng master key
Parse.Cloud.define('updateUserByAdmin', updateUserByAdmin, {
  requireUser: true,
  fields: {
    userId: {
      type: String,
      required: true,
      options: (val: string) => !!val,
      error: 'userId là bắt buộc',
    },
    data: {
      type: Object,
      required: true,
    },
  },
});

// ─── Khởi tạo ViettelPost token khi Parse Cloud load ──────────────────────────
// Delay nhỏ để Parse Server kết nối DB xong trước khi query ExternalConfig
setTimeout(() => {
  initViettelPostToken().catch(err =>
    console.error('[VTP Token] Init failed:', err)
  );
}, 3000);

// ─── Đảm bảo unique index trên AppointmentSchedule.slot ───────────────────────
// Chặn race condition: 2 request đến cùng lúc đều pass count() === 0 check
// trong beforeSave, nhưng MongoDB sẽ reject cái insert thứ hai.
// Index là idempotent (ensureIndex) — chạy lại nhiều lần không gây lỗi.
setTimeout(() => {
  const schema = new Parse.Schema('AppointmentSchedule');
  schema
    .addIndex('slot_unique_idx', { slot: 1 }, { unique: true, sparse: true })
    .update({ useMasterKey: true } as any)
    .then(() =>
      console.info('[AppointmentSchedule] Unique index on slot ensured')
    )
    .catch((err: any) => {
      // Index đã tồn tại → lỗi code 111 hoặc 'already exists' — bỏ qua
      const msg = err?.message || '';
      if (
        err?.code === 111 ||
        msg.includes('already exists') ||
        msg.includes('IndexOptionsConflict')
      ) {
        console.info('[AppointmentSchedule] Unique index already exists — OK');
      } else {
        console.error(
          '[AppointmentSchedule] Failed to ensure unique index:',
          msg
        );
      }
    });
}, 4000);

// ─── Đảm bảo unique index trên ConsignmentCounter.groupId ─────────────────────
// Tránh tạo 2 counter cho cùng 1 group nếu 2 consignment tạo đồng thời
// khi counter chưa tồn tại. MongoDB sẽ reject insert thứ hai → getNextConsignmentSeq
// sẽ fetch lại counter vừa được tạo.
setTimeout(() => {
  const counterSchema = new Parse.Schema('ConsignmentCounter');
  counterSchema
    .addIndex('groupId_unique_idx', { groupId: 1 }, { unique: true })
    .update({ useMasterKey: true } as any)
    .then(() =>
      console.info('[ConsignmentCounter] Unique index on groupId ensured')
    )
    .catch((err: any) => {
      const msg = err?.message || '';
      if (
        err?.code === 111 ||
        msg.includes('already exists') ||
        msg.includes('IndexOptionsConflict')
      ) {
        console.info('[ConsignmentCounter] Unique index already exists — OK');
      } else {
        console.error(
          '[ConsignmentCounter] Failed to ensure unique index:',
          msg
        );
      }
    });
}, 4500);
