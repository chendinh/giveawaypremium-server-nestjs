import { CampaignStatusEnums } from "../../models/campaign";

const Validator = require('fastest-validator');

const beforeSave = {
	fields: {
    name: {
      type: String,
      required:true,
    },
    publicAt: {
      type: Object,
      required:true,
      options: val => {
        const validator = new Validator();
        const schema = {
          '__type': { type: 'string', empty: false, enum: ['Date'] },
	        'iso': { type: "date", empty: false,  convert: true}
        };

        const check = validator.compile(schema);
				const isValid = check({ ...val });
				if (typeof isValid === 'object') throw isValid;
        return new Date(val.iso) > new Date();
			},
			error: `publicAt must be greate than now`
    },
    products: {
      type: Object,
      required:true,
      options: products => {
        const validator = new Validator();
				const schema = {
          products: {
            type: 'array', 
            items: {
              type: 'object',
              props: {
                '__type': { type: 'string', empty: false, enum: ['Pointer'] },
                'className': { type: 'string', empty: false, enum: ['Product'] },
                'objectId': { type: 'string', empty: false },
              }
            }
          }	
				};
				const check = validator.compile(schema);
				const isValid = check({ products });
				if (typeof isValid === 'object') throw isValid;
				return isValid;
			},
    },
    status: {
      type: String,
      required:true,
      options: val => {
				return Object.values(CampaignStatusEnums).includes(val);
			},
			error: `Status not includes ${Object.values(CampaignStatusEnums)}`
    },
	}
};

export {
  beforeSave
};
