export interface IMailOptions {
  from: string;
  service: string;
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string | undefined;
    pass: string | undefined;
  };
  pool?: boolean;
}

export interface IMailData {
  mailTo: string;
  title: string;
  html?: string;
  text?: string;
}

export interface IEmailFactory {
  send(data: IMailData): Promise<void>;
}
