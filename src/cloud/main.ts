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

import { findAll } from './nhanh-category';
import { activeCampaign } from './job/campaign';
import { getAdministativeUnits } from './function/administrative-units';
import { tranporterAction } from './function/transporter';
import { requestOrderGuest } from './function/guest-order';
import { remiderIndividualConsignment, reminderConsignmentGroup } from './function/mail';

const USER_CLOUD = {
	beforeCreate: async (request: Parse.Cloud.BeforeSaveRequest<Parse.User>): Promise<void> => {
		const object = request.object;
		const roleACL = new Parse.ACL();
		roleACL.setRoleWriteAccess('administrator', true);
		roleACL.setRoleReadAccess('administrator', true);
		roleACL.setPublicReadAccess(true);
		object.setACL(roleACL);
		
	}
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
				error: `role not includes ${Object.values(USER_ROLES)}`
			}
		}
	}
);

Parse.Cloud.beforeDelete(
	Parse.User, 
	async (request: Parse.Cloud.BeforeDeleteRequest<Parse.User>) => {}, {
	requireMaster: true
});

// cloud code for Send Email
Parse.Cloud.define<(param: { objectId: string; }) => { objectId: string; }>(
	"emailRemiderIndividualConsignment", 
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

Parse.Cloud.define<(param: { groupId: string; }) => { groupId: string; }>(
	"emailReminderConsignmentGroup", 
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

Parse.Cloud.define("email", async (request: Parse.Cloud.FunctionRequest): Promise<{success: boolean}> => {
	try {
		const {params} = request;
		const type = params.type as string;
		const data = params.data;
		const path = EMAIL_PATHS[type];
		const options = {};
		const htlmStr = await ejs.renderFile(path, data, options);
		const emailFactory = MailFactory.getMail(MAIL_TYPE.SENDINBLUE, mailConfigs);
		emailFactory.send({
			mailTo: params.mailTo,
			title: params.title || 'non-reply', // Subject line
      html: htlmStr
		});

		return { success: true };
	} catch (error) {
		throw error;
	}
}, {
	fields: {
		type: {
      type: String,
      options: val => {
				return Object.values(EMAIL_TYPES).includes(val);
			},
			error: `Type not includes ${Object.values(EMAIL_TYPES)}`
		},
		mailTo: {
			type: String,
			options: val => {
				const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    		return re.test(String(val).toLowerCase());
			},
			error: `email invalid`
		},
	}
});

// cloud code for Consignment
Parse.Cloud.beforeSave('Consignment', ConsignmentCloud.beforeSave, ConsignmentCloudValidate.beforeSave);
Parse.Cloud.afterSave('Consignment', ConsignmentCloud.afterSave);
Parse.Cloud.beforeDelete(
	'Consignment', 
	async (request) => {}, {
	requireMaster: true
});
Parse.Cloud.beforeDelete(
	'Role', 
	async (request) => {}, {
	requireMaster: true
});
Parse.Cloud.beforeDelete(
	'Agency', 
	async (request) => {}, {
	requireMaster: true
});
Parse.Cloud.beforeDelete(
	'AppointmentSchedule', 
	async (request) => {}, {
	requireMaster: true
});
Parse.Cloud.beforeDelete(
	'Category', 
	async (request) => {}, {
	requireMaster: true
});
Parse.Cloud.beforeDelete(
	'ConsignmentGroup', 
	async (request) => {}, {
	requireMaster: true
});
Parse.Cloud.beforeDelete(
	'Product', 
	async (request) => {}, {
	requireMaster: true
});
Parse.Cloud.beforeDelete(
	'SubCategory', 
	async (request) => {}, {
	requireMaster: true
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
Parse.Cloud.beforeSave('Campaign', CampaignCloud.beforeSave, CampaignCloudValidate.beforeSave);
// Parse.Cloud.afterSave('Campaign', CampaignCloud.afterSave);

// cloud code for TransporterCloud
Parse.Cloud.beforeSave('Transporter', TransporterCloud.beforeSave);
Parse.Cloud.afterSave('Transporter', TransporterCloud.afterSave);

// cloud code for Order Request
Parse.Cloud.beforeSave('OrderRequest', OrderRequestCloud.beforeSave);
Parse.Cloud.afterSave('OrderRequest', OrderRequestCloud.afterSave);
Parse.Cloud.beforeFind('OrderRequest', OrderRequestCloud.beforeFind);

// Define Job
Parse.Cloud.job("ActiveCampaign", activeCampaign);

// Define Function
Parse.Cloud.define('administativeUnits', getAdministativeUnits);
Parse.Cloud.define('transporter', tranporterAction, {
	// requireUser: true,
	fields: {
		service: {
			type: String,
			options: val => {
    		return ['giaohangtietkiem'].includes(val);
			},
		},
		action: {
			type: String,
			options: val => {
    		return ['PRICE_ESTIMATE', 'CREATE_ORDER', 'GET_ORDER_LABEL', 'CANCEL_ORDER'].includes(val);
			},
		},
		data: { type: Object },
	}
});

Parse.Cloud.define<
	(param: { productId: string; count: number; }) => { productId: string; count: number; }
>(
	'orderGuest', 
	requestOrderGuest,
	{
		fields: {
			productId: {
				type: String,
				required: true,
				options: val => !!val,
				error: 'required productId'
			},
			count: {
				type: Number,
				required: true,
				options: val => val > 0,
				error: 'required count greater than 0'
			}
		}
	}
);
