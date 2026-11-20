import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  CurrentUser,
  type CurrentUser as CurrentUserType,
} from '../auth/current-user.decorator.js';
import { OptionalAuth } from '../auth/roles.decorator.js';
import { deviceKey, hashKey } from '../common/device.js';
import { AppError } from '../common/errors/app-error.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { CreateUploadDto } from './media.dto.js';
import { type MediaCaller, MediaService } from './media.service.js';

@Controller('media')
@OptionalAuth()
export class MediaController {
  constructor(
    private readonly media: MediaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('uploads')
  async createUpload(
    @CurrentUser() me: CurrentUserType | undefined,
    @Req() req: Request,
    @Body() dto: CreateUploadDto,
  ) {
    return this.media.createUpload(this.caller(me, req), dto.contentType, dto.sizeBytes);
  }

  @Post(':id/complete')
  @HttpCode(200)
  async complete(
    @CurrentUser() me: CurrentUserType | undefined,
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.media.complete(this.caller(me, req), id);
  }

  private caller(me: CurrentUserType | undefined, req: Request): MediaCaller {
    if (me) return { userId: me.id };
    const deviceHash = deviceKey(req, this.env.DEVICE_HASH_SALT);
    if (!deviceHash) throw new AppError(422, 'device.required', 'X-Device-Id');
    return { deviceHash, ipHash: hashKey(req.ip ?? 'unknown', this.env.DEVICE_HASH_SALT) };
  }
}
