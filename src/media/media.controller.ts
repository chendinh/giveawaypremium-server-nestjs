import {
  Controller,
  Post,
  Req,
  Res,
  Next,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import { cloudinaryV2 } from '../external-services/cloudinary';
import { Media } from '../models/media';
import { parseServerConfig } from '../config/parse.config';
import { diskStorage } from 'multer';

@Controller('media')
export class MediaController {
  @Post()
  @UseInterceptors(
    FileInterceptor('media', {
      storage: diskStorage({ destination: './tmp/' }),
    }),
  )
  async upload(
    @Req() req: Request & { file?: Express.Multer.File },
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    try {
      const headers = req.headers;

      if (
        headers['x-parse-application-id'] !== parseServerConfig.appId ||
        headers['x-parse-rest-api-key'] !== parseServerConfig.restAPIKey ||
        !headers['x-parse-session-token']
      ) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'forbidden');
      }

      const file = req.file;
      if (file) {
        const [, resourceFormat] = file.mimetype.split('/');
        fs.renameSync(`${file.path}`, `${file.path}.${resourceFormat}`);
        const response = await cloudinaryV2.uploader.upload(
          `${file.path}.${resourceFormat}`,
        );
        const media = new Media();
        const result = await media.save(
          {
            data: response,
            cloud: 'Cloudinary',
            isDraft: true,
            type: response.signature,
          },
          {
            useMasterKey: true,
            sessionToken: headers['x-parse-session-token'] as string,
          },
        );

        return res.json(result);
      }

      throw new Error('Please push media');
    } catch (error) {
      next(error);
    }
  }
}
