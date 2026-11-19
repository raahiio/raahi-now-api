import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type CurrentUser as CurrentUserType } from '../auth/current-user.decorator.js';
import { RequireAuth } from '../auth/roles.decorator.js';
import { RaiseCapDto } from './dto/raise-cap.dto.js';
import { CreateDropDto } from './dto/create-drop.dto.js';
import { UpdateDropDto } from './dto/update-drop.dto.js';
import { DropsService } from './drops.service.js';
import { LocalRequiredGuard } from './local-required.guard.js';

@Controller()
@RequireAuth()
@UseGuards(LocalRequiredGuard)
export class DropsController {
  constructor(private readonly drops: DropsService) {}

  @Post('drops')
  create(@CurrentUser() me: CurrentUserType, @Body() dto: CreateDropDto) {
    return this.drops.create(me, dto);
  }

  @Patch('drops/:id')
  update(@CurrentUser() me: CurrentUserType, @Param('id') id: string, @Body() dto: UpdateDropDto) {
    return this.drops.update(me, id, dto);
  }

  @Post('drops/:id/submit')
  @HttpCode(200)
  submit(@CurrentUser() me: CurrentUserType, @Param('id') id: string) {
    return this.drops.submit(me, id);
  }

  @Post('drops/:id/pause')
  @HttpCode(200)
  pause(@CurrentUser() me: CurrentUserType, @Param('id') id: string) {
    return this.drops.pause(me, id);
  }

  @Post('drops/:id/resume')
  @HttpCode(200)
  resume(@CurrentUser() me: CurrentUserType, @Param('id') id: string) {
    return this.drops.resume(me, id);
  }

  @Post('drops/:id/end')
  @HttpCode(200)
  end(@CurrentUser() me: CurrentUserType, @Param('id') id: string) {
    return this.drops.end(me, id);
  }

  @Post('drops/:id/raise-cap')
  @HttpCode(200)
  raiseCap(@CurrentUser() me: CurrentUserType, @Param('id') id: string, @Body() dto: RaiseCapDto) {
    return this.drops.raiseCap(me, id, dto.unlocksPerDay);
  }

  @Post('drops/:id/duplicate')
  duplicate(@CurrentUser() me: CurrentUserType, @Param('id') id: string) {
    return this.drops.duplicate(me, id);
  }

  @Get('me/drops')
  async list(@CurrentUser() me: CurrentUserType) {
    return { items: await this.drops.listMine(me) };
  }

  @Get('me/drops/:id')
  get(@CurrentUser() me: CurrentUserType, @Param('id') id: string) {
    return this.drops.getMine(me, id);
  }
}
