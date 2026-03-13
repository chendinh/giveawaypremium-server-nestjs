import fetch from 'node-fetch'; 
import md5 from 'md5';
import FormData from 'form-data';
import logger from '../../plugins/logger';
import { NhanhResponse, NhanhService, NhanhServiceOptions } from './interface';

export class NhanhServiceImpl implements NhanhService {
  protected server: string;
  protected version: string;
  protected secretKey: string;
  protected apiUsername: string;

  constructor(options: NhanhServiceOptions) {
    this.server = options.server;
    this.version = options.version;
    this.secretKey = options.secretKey;
    this.apiUsername = options.apiUsername;
  }

  private createChecksum(data: string): string {
    return md5(md5(this.secretKey + data) + data);
  }

  private dataToString(data: string | Object): string {
    return (typeof data === 'string') ? data : JSON.stringify(data);
  }

  protected async request<T = any, R = NhanhResponse<T>>(
    url: string, 
    dataReq: string | Object, 
    storeId: null | string = null,
  ): Promise<R> {
    try {
      const form = new FormData();
      const version = this.version;
      const apiUsername = this.apiUsername;
      const data = this.dataToString(dataReq);
      const checksum = this.createChecksum(data);
      form.append('version', version);
      form.append('apiUsername', apiUsername);
      form.append('data', data);
      form.append('checksum', checksum);
      if (storeId) {
        form.append('storeId', storeId);
      }
      
      const result = await fetch(`${this.server}${url}`, { method: 'POST', body: form })
      const json = await result.json();
      if (json.code === 0) throw new Error(`${json.messages}`);

      return json;
    } catch (error) {
      logger.error(`NhanhService: Request ${JSON.stringify({
        server: this.server,
        version: this.version,
        url: url,
        data: dataReq,
        store: storeId,
      })}
      Error: ${error}`);
      throw error;
    }
  }
}
