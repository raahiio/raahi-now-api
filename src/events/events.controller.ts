import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type CurrentUser as CurrentUserType } from '../auth/current-user.decorator.js';
import { OptionalAuth, RequireAuth } from '../auth/roles.decorator.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { deviceKey } from '../common/device.js';
import { callerKeys } from '../guests/caller-keys.js';
import { GuestAuthGuard, type RequestWithGuest } from '../guests/guest-auth.guard.js';
import { CreateEventDto } from './dto/create-event.dto.js';
import { UpdateEventDto } from './dto/update-event.dto.js';
import { type EventActor, EventsService } from './events.service.js';

@Controller()
@RequireAuth()
export class EventsController {
  constructor(
    private readonly events: EventsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** A signed-in caller takes the account path, an anonymous one the guest path. */
  @Post('events')
  @OptionalAuth()
  create(@CurrentUser() me: CurrentUserType | undefined, @Body() dto: CreateEventDto, @Req() req: Request) {
    return me ? this.events.create(me, dto) : this.events.createAsGuest(dto, callerKeys(req, this.env.DEVICE_HASH_SALT));
  }

  @Patch('events/:id')
  @OptionalAuth()
  @UseGuards(GuestAuthGuard)
  update(
    @CurrentUser() me: CurrentUserType | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @Req() req: RequestWithGuest,
  ) {
    return this.events.update(this.actor(me, req), id, dto);
  }

  @Post('events/:id/cancel')
  @HttpCode(200)
  @OptionalAuth()
  @UseGuards(GuestAuthGuard)
  cancel(@CurrentUser() me: CurrentUserType | undefined, @Param('id') id: string, @Req() req: RequestWithGuest) {
    return this.events.cancel(this.actor(me, req), id);
  }

  @Get('me/events')
  async list(@CurrentUser() me: CurrentUserType) {
    return { items: await this.events.listMine(me) };
  }

  private actor(me: CurrentUserType | undefined, req: RequestWithGuest): EventActor {
    if (me) return { kind: 'user', userId: me.id };
    // GuestAuthGuard has already admitted the request, so `req.guest` is set.
    return { kind: 'guest', identityId: req.guest!.identityId, deviceHash: deviceKey(req, this.env.DEVICE_HASH_SALT) };
  }
}
