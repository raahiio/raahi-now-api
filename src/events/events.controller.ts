import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type CurrentUser as CurrentUserType } from '../auth/current-user.decorator.js';
import { RequireAuth } from '../auth/roles.decorator.js';
import { CreateEventDto } from './dto/create-event.dto.js';
import { UpdateEventDto } from './dto/update-event.dto.js';
import { EventsService } from './events.service.js';

@Controller()
@RequireAuth()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post('events')
  create(@CurrentUser() me: CurrentUserType, @Body() dto: CreateEventDto) {
    return this.events.create(me, dto);
  }

  @Patch('events/:id')
  update(@CurrentUser() me: CurrentUserType, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.events.update(me, id, dto);
  }

  @Post('events/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() me: CurrentUserType, @Param('id') id: string) {
    return this.events.cancel(me, id);
  }

  @Get('me/events')
  async list(@CurrentUser() me: CurrentUserType) {
    return { items: await this.events.listMine(me) };
  }
}
