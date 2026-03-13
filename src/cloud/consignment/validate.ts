const Validator = require('fastest-validator');

const beforeSave = {
	fields: {
		productList: {
			type: Array,
			options: products => {
				const validator = new Validator();
				const schema = {
					productList: { 
						type: 'array', 
						items: {
							type: 'object',
							props: {
								key: { type: 'number', optional: true },
								price: { type: 'number', optional: false },
								count: { type: 'number', optional: false },
								priceAfterFee: { type: 'number', optional: false },
								soldNumberProduct: { type: 'number', optional: true },
								remainNumberProduct: { type: 'number', optional: true },
								moneyBackProduct: { type: 'number', optional: true },
								name: { type: 'string', empty: false, optional: false },
								note: { type: 'string', optional: false },
								categoryId: { type: 'string', optional: false },
								subCategoryId: { type: 'string', optional: true },
							}
						} 
					},
				};
				const check = validator.compile(schema);
				const isValid = check({ productList: [...products] });
				if (typeof isValid === 'object') throw isValid;
				return isValid;
			},
		}
	}
};

export {
  beforeSave
};
