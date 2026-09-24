import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';

@Controller()
export class AppController {
  @Get()
  getRoot(@Res() res: Response) {
    res.send('Permission denied');
  }

  // DEBUG TẠM THỜI — điều tra vấn đề Master Key 401/403 trên production.
  // Chỉ trả độ dài + 2 ký tự đầu/cuối, KHÔNG lộ toàn bộ secret. SẼ XÓA SAU KHI XONG.
  @Get('__debug_masterkey_check')
  debugMasterKey(@Res() res: Response) {
    const mk = process.env.MASTER_KEY || '';
    const appId = process.env.APP_ID || '';
    res.json({
      masterKeyLength: mk.length,
      masterKeyPreview:
        mk.length > 4 ? `${mk.slice(0, 2)}...${mk.slice(-2)}` : '(too short)',
      masterKeyHasLeadingSpace: mk !== mk.trimStart(),
      masterKeyHasTrailingSpace: mk !== mk.trimEnd(),
      appIdLength: appId.length,
      appIdPreview:
        appId.length > 4
          ? `${appId.slice(0, 2)}...${appId.slice(-2)}`
          : '(too short)',
      nodeEnv: process.env.NODE_ENV,
    });
  }
}
