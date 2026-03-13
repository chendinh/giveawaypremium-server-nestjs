import { Controller, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';

@Controller('hooks')
export class HooksController {
  @Post('product')
  async updateProduct(@Req() req: Request, @Res() res: Response) {
    const body = req.body;
    const nhanhProducts = body.data ? JSON.parse(body.data) : undefined;
    if (!nhanhProducts || !Object.keys(nhanhProducts).length)
      return res.json({ success: true });

    return res.json({ success: true });
  }

  @Post('inventory')
  async listenInventory(@Req() req: Request, @Res() res: Response) {
    const body = req.body;
    console.log('hook inventory', body);
    const inventories = body.data ? JSON.parse(body.data) : [];
    console.log('hook inventory data', JSON.stringify(inventories));
    if (!inventories || !Object.keys(inventories).length)
      return res.json({ success: false });

    return res.json({ success: true });
  }
}
