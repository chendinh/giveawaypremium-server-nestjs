import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Controller()
export class AppController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getRoot(@Res() res: Response) {
    res.send('Permission denied');
  }

  // DEBUG TẠM THỜI — điều tra vấn đề Master Key 401/403 trên production.
  // Chỉ trả độ dài + 2 ký tự đầu/cuối, KHÔNG lộ toàn bộ secret. SẼ XÓA SAU KHI XONG.
  @Get('__debug_masterkey_check')
  debugMasterKey(@Res() res: Response) {
    const preview = (v: string) =>
      v.length > 4 ? `${v.slice(0, 2)}...${v.slice(-2)}` : '(too short)';

    const mkEnv = process.env.MASTER_KEY || '';
    const mkConfig = this.configService.get<string>('MASTER_KEY') || '';
    const appIdEnv = process.env.APP_ID || '';
    const appIdConfig = this.configService.get<string>('APP_ID') || '';

    res.json({
      masterKey_fromProcessEnv: {
        length: mkEnv.length,
        preview: preview(mkEnv),
      },
      masterKey_fromConfigService: {
        length: mkConfig.length,
        preview: preview(mkConfig),
      },
      masterKey_matches: mkEnv === mkConfig,
      appId_fromProcessEnv: {
        length: appIdEnv.length,
        preview: preview(appIdEnv),
      },
      appId_fromConfigService: {
        length: appIdConfig.length,
        preview: preview(appIdConfig),
      },
      appId_matches: appIdEnv === appIdConfig,
      nodeEnv: process.env.NODE_ENV,
    });
  }
}
