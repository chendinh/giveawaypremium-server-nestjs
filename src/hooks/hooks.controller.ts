import {
  Controller,
  Get,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import logger from '../plugins/logger';
import { getSepayConfig } from '../config/sepay.config';
import { upsertBankTransactions } from '../cloud/bank-transaction/upsert';
import { normalizeWebhookPayload } from '../external-services/sepay/sepay.normalize';
import { verifySepayWebhook } from '../external-services/sepay/sepay.webhook-auth';
import {
  getStatusByService,
  isVtpFinalStatus,
} from '../common/transporter.utils';
import { ViettelPostWebhookPayload } from '../external-services/transporter/viettelpost.types';
import { OrderRequestStatus } from '../constants/order-status';

@Controller('hooks')
export class HooksController {
  // ─── VTP label proxy ─────────────────────────────────────────────────────

  /**
   * GET /hooks/vtp-label?url=<encoded_vtp_url>
   * Proxy nhãn VTP về client để embed bằng srcdoc (tránh CORS / X-Frame).
   * Rewrite relative path → absolute để CSS/images load được.
   */
  @Get('vtp-label')
  async vtpLabelProxy(@Query('url') url: string, @Res() res: Response) {
    const VTP_PRINT_BASE = 'https://digitalize.viettelpost.vn/DigitalizePrint';

    if (!url || !url.startsWith('https://digitalize.viettelpost.vn/')) {
      return res.status(400).send('Invalid url');
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(502).send('VTP returned ' + response.status);
      }
      let html = await response.text();

      // Rewrite relative → absolute để assets load khi dùng srcdoc
      html = html
        .replace(/src="(\.\/|(?!http))/g, `src="${VTP_PRINT_BASE}/`)
        .replace(/href="(\.\/|(?!http))/g, `href="${VTP_PRINT_BASE}/`);

      // Thêm base tag để đảm bảo mọi relative URL đều resolve đúng
      html = html.replace('<head>', `<head><base href="${VTP_PRINT_BASE}/">`);

      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(html);
    } catch (err) {
      return res.status(502).send('Proxy error');
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Khi VTP xác nhận giao thành công (status 501):
   * Tìm Order liên quan → tìm OrderRequest của Order đó → chuyển sang COMPLETED.
   */
  private async completeOrderRequest(transporter: Parse.Object): Promise<void> {
    const orderPointer = transporter.get('order');
    if (!orderPointer) return;

    const orderQuery = new Parse.Query('Order');
    const order = await orderQuery
      .include('orderRequest')
      .get(orderPointer.id, { useMasterKey: true });

    const orderRequest = order.get('orderRequest');
    if (!orderRequest) return;

    const fetched = await orderRequest.fetch({ useMasterKey: true });
    if (fetched.get('status') === OrderRequestStatus.IN_ORDER) {
      await fetched.save(
        { status: OrderRequestStatus.COMPLETED },
        { useMasterKey: true }
      );
      logger.info(`[VTP Webhook] OrderRequest ${fetched.id} → COMPLETED`);
    }
  }

  // ─── Nhanh.vn webhooks ──────────────────────────────────────────────────

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
    logger.info('[Hook] inventory received');
    const inventories = body.data ? JSON.parse(body.data) : [];
    if (!inventories || !Object.keys(inventories).length)
      return res.json({ success: false });
    return res.json({ success: true });
  }

  // ─── ViettelPost webhook ─────────────────────────────────────────────────

  /**
   * Nhận webhook từ ViettelPost khi trạng thái đơn thay đổi
   * POST /hooks/viettelpost
   *
   * Cấu hình URL này tại: partner.viettelpost.vn
   *   → Cấu hình tài khoản → Thông tin nhận hành trình
   *
   * Lưu ý theo tài liệu VTP:
   * - Luôn trả HTTP 200 (kể cả lỗi) để VTP không retry
   * - VTP retry 5 lần nếu không nhận 200
   * - Hành trình có thể trùng/thừa → phải xử lý idempotent
   * - Trạng thái cuối (101/107/201/501/503/504): không phát sinh thêm → bypass nếu nhận lại
   * - Response phải < 1 giây
   */
  @Post('viettelpost')
  async viettelpostWebhook(@Req() req: Request, @Res() res: Response) {
    const payload = req.body as ViettelPostWebhookPayload;

    // 1. Validate payload structure
    if (!payload?.DATA?.ORDER_NUMBER) {
      logger.warn('[VTP Webhook] Invalid payload — missing DATA.ORDER_NUMBER');
      return res
        .status(200)
        .json({ success: false, message: 'Invalid payload' });
    }

    // 2. Xác thực TOKEN (secret key được cấu hình ở "Secret parameters" trên portal VTP)
    const webhookSecret = process.env.VIETTELPOST_WEBHOOK_SECRET;
    if (webhookSecret && payload.TOKEN !== webhookSecret) {
      logger.warn(
        `[VTP Webhook] Token mismatch for order ${payload.DATA.ORDER_NUMBER}`
      );
      // Trả 200 để VTP không retry, nhưng không xử lý
      return res
        .status(200)
        .json({ success: false, message: 'Token mismatch' });
    }

    const { ORDER_NUMBER, ORDER_STATUS, STATUS_NAME, ORDER_REFERENCE } =
      payload.DATA;

    logger.info(
      `[VTP Webhook] ${ORDER_NUMBER} | status=${ORDER_STATUS} (${STATUS_NAME})` +
        (ORDER_REFERENCE ? ` | ref=${ORDER_REFERENCE}` : '')
    );

    // 3. Cập nhật trạng thái Transporter object trong Parse
    try {
      const normalizedStatus = getStatusByService('viettelpost', ORDER_STATUS);

      // Query Transporter theo ORDER_NUMBER lưu trong res.data.ORDER_NUMBER lúc tạo đơn.
      // Dùng equalTo trực tiếp trên field lồng nhau thay vì findAll() + filter tay —
      // findAll() là iteration API của Parse SDK, KHÔNG tương thích với sort/skip/limit
      // ("Cannot iterate on a query with sort, skip, or limit") nên descending() trước đó
      // luôn throw ngay từ dòng này, khiến toàn bộ webhook rơi vào catch và không bao giờ
      // cập nhật được Transporter dù vẫn trả success:true giả cho VTP.
      const transporterQuery = new Parse.Query('Transporter');
      transporterQuery.equalTo('service', 'viettelpost');
      transporterQuery.equalTo('res.data.ORDER_NUMBER', ORDER_NUMBER);
      const transporter = await transporterQuery.first({ useMasterKey: true });

      if (!transporter) {
        // Đơn lạ — checklist VTP: ghi log và bypass
        logger.warn(
          `[VTP Webhook] Transporter not found for order ${ORDER_NUMBER}`
        );
        return res
          .status(200)
          .json({ success: true, message: 'Order not found, bypass' });
      }

      // Nếu đơn đã ở trạng thái cuối → bypass (idempotent)
      const currentVtpStatus: number = transporter.get('vtpStatus');
      if (currentVtpStatus && isVtpFinalStatus(currentVtpStatus)) {
        logger.info(
          `[VTP Webhook] ${ORDER_NUMBER} already at final status ${currentVtpStatus}, bypass`
        );
        return res
          .status(200)
          .json({ success: true, message: 'Already final status, bypass' });
      }

      // Cập nhật status + lưu toàn bộ webhook data để tra cứu sau
      await transporter.save(
        {
          status: normalizedStatus, // trạng thái chuẩn hóa nội bộ (TransporterStatus)
          vtpStatus: ORDER_STATUS, // mã gốc từ VTP để check final status
          vtpStatusName: STATUS_NAME, // tên trạng thái VTP
          lastWebhook: payload.DATA, // toàn bộ data webhook gần nhất
        },
        { useMasterKey: true }
      );

      // Khi đơn giao thành công (VTP 501) → chuyển OrderRequest sang COMPLETED
      if (ORDER_STATUS === 501) {
        this.completeOrderRequest(transporter).catch(err =>
          logger.error(
            `[VTP Webhook] completeOrderRequest failed for ${ORDER_NUMBER}:`,
            err
          )
        );
      }

      logger.info(
        `[VTP Webhook] Updated ${ORDER_NUMBER}: ${normalizedStatus} (${ORDER_STATUS})`
      );
    } catch (error) {
      // Ghi log nhưng vẫn trả 200 — VTP không retry
      logger.error(`[VTP Webhook] Error processing ${ORDER_NUMBER}:`, error);
    }

    // Luôn trả 200 theo yêu cầu tài liệu VTP
    return res.status(200).json({ success: true });
  }

  // ─── SePay webhook (biến động số dư ngân hàng) ───────────────────────────

  /**
   * Nhận giao dịch ngân hàng từ SePay
   * POST /hooks/sepay
   *
   * Cấu hình tại my.sepay.vn → Webhooks (chọn sự kiện "Cả hai" để nhận cả tiền
   * vào lẫn tiền ra). Kiểu chứng thực: HMAC-SHA256 (SEPAY_WEBHOOK_SECRET, khuyến
   * nghị) hoặc API Key (SEPAY_WEBHOOK_API_KEY). Chưa cấu hình khoá thì từ chối hết.
   *
   * Theo tài liệu SePay:
   * - Chỉ tính thành công khi trả HTTP 200/201 và đúng body {"success": true}
   * - Lỗi/ timeout → SePay retry tối đa 7 lần, nên phải idempotent (xử lý trùng
   *   bằng fingerprint trong upsertBankTransactions)
   * - Request không hợp lệ (401/400) cũng bị retry nhưng không gây hại
   */
  @Post('sepay')
  async sepayWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response
  ) {
    const auth = verifySepayWebhook({
      headers: req.headers,
      rawBody: req.rawBody,
    });
    if (!auth.ok) {
      logger.warn(`[SePay Webhook] Từ chối request: ${auth.reason}`);
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const tx = normalizeWebhookPayload(req.body);
    if (!tx) {
      logger.warn('[SePay Webhook] Payload thiếu hoặc sai trường bắt buộc');
      return res
        .status(400)
        .json({ success: false, message: 'Invalid payload' });
    }

    // Tài khoản không thuộc shop (SePay công ty có thể liên kết nhiều tài khoản):
    // báo thành công để SePay không retry nhưng không lưu.
    const { accountNumbers } = getSepayConfig();
    if (
      accountNumbers.length > 0 &&
      !accountNumbers.includes(tx.accountNumber)
    ) {
      return res.status(200).json({ success: true });
    }

    try {
      const { inserted } = await upsertBankTransactions([tx]);
      logger.info(
        `[SePay Webhook] ${tx.type} ${tx.amountVnd}đ ref=${tx.referenceCode || tx.sepayId} ` +
          (inserted > 0 ? '(mới)' : '(đã có, bỏ qua)')
      );
      return res.status(200).json({ success: true });
    } catch (error) {
      // 500 để SePay retry — giao dịch chưa được lưu
      logger.error(
        `[SePay Webhook] Lưu giao dịch lỗi: ${error?.message || error}`
      );
      return res
        .status(500)
        .json({ success: false, message: 'Internal error' });
    }
  }
}
