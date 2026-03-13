export const mailConfigs = {
  from: process.env.MAIL_ADDRESS || 'giveawaypremiumquan1@gmail.com',
  service: process.env.MAIL_SERVICE || 'gmail',
  host: process.env.MAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.MAIL_PORT) || 587,
  secure: process.env.MAIL_SECURE === 'true',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
  pool: true,
};

export const sendinblueConfigs = {
  apiKey: process.env.SENDINBLUE_API_KEY,
};
