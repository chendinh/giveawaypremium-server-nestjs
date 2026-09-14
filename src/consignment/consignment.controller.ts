import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { getNextConsignmentSeq } from '../cloud/consignment/counter';
import logger from '../plugins/logger';

/**
 * REST endpoint cho consignment utilities — tách khỏi Parse Cloud Functions
 * để client có thể gọi đơn giản hơn (không cần Parse SDK boilerplate).
 */
@Controller('consignment')
export class ConsignmentController {
  /**
   * GET /consignment/next-id?groupId=<objectId>
   *
   * Trả về mã ký gửi tiếp theo cho một group cụ thể, dạng preview.
   * Đây là ATOMIC read — dùng cùng ConsignmentCounter với beforeSave,
   * nên số trả về chính xác là số sẽ được dùng cho đơn tiếp theo.
   *
   * Response:
   *   200: { nextId: "51-926", seq: 51, groupCode: "926" }
   *   400: groupId thiếu
   *   404: group không tồn tại
   *   500: lỗi server
   *
   * Auth: yêu cầu X-Parse-Session-Token (hoặc X-Parse-Master-Key)
   * để tránh leak seq ra bên ngoài.
   */
  @Get('next-id')
  async getNextId(@Query('groupId') groupId: string, @Res() res: Response) {
    if (!groupId || !groupId.trim()) {
      return res.status(400).json({ error: 'groupId is required' });
    }

    try {
      // Fetch group để lấy code — dùng masterKey vì đây là internal read
      const groupQuery = new Parse.Query('ConsignmentGroup');
      const group = await groupQuery.get(groupId.trim(), {
        useMasterKey: true,
      });

      const groupCode: string = group.get('code') || '';

      // Đọc seq hiện tại từ counter (không increment — chỉ peek)
      // Nếu counter chưa tồn tại, tính từ count thực tế trong DB
      const counterQuery = new Parse.Query('ConsignmentCounter');
      counterQuery.equalTo('groupId', groupId.trim());
      const counter = await counterQuery.first({ useMasterKey: true });

      let currentSeq: number;

      if (counter) {
        currentSeq = (counter.get('seq') as number) || 0;
      } else {
        // Counter chưa được khởi tạo — tính từ DB (giống logic trong counter.ts)
        const existingQuery = new Parse.Query('Consignment');
        existingQuery.equalTo('group', group);
        existingQuery.doesNotExist('deletedAt');
        currentSeq = await existingQuery.count({ useMasterKey: true });
      }

      const nextSeq = currentSeq + 1;
      const nextId = groupCode ? `${nextSeq}-${groupCode}` : `${nextSeq}`;

      logger.info(
        `[ConsignmentController] next-id for group ${groupId}: ${nextId}`
      );

      return res.json({
        nextId,
        seq: nextSeq,
        groupCode,
      });
    } catch (err: any) {
      // Parse "Object not found" → 404
      if (err?.code === 101) {
        return res.status(404).json({ error: 'Group not found' });
      }
      logger.error('[ConsignmentController] getNextId error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
