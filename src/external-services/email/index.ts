import { NodemailerFactory } from './nodemailer';
import { IMailOptions, IEmailFactory } from './interface';
import { MAIL_TYPE } from './constants';
import { SendInBlueMailerFactory } from './sendinblue';

export interface IMailFactory {}

export class MailFactory implements IMailFactory {
  private static mail: IEmailFactory;

  static getMail(type: MAIL_TYPE, options: IMailOptions): IEmailFactory {
    if (this.mail) return this.mail;

    switch (type) {
      case MAIL_TYPE.NODEMAILER:
        this.mail = new NodemailerFactory(options);
        return this.mail;
      case MAIL_TYPE.SENDINBLUE:
        this.mail = new SendInBlueMailerFactory(options);
        return this.mail;
      default:
        throw new Error('INVALID_TYPE_MAIL');
    }
  }
}
