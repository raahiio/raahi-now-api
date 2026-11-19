import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type CurrentUser as CurrentUserType } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { ReasonDto } from './review.dto.js';
import { ReviewService } from './review.service.js';

@Controller('admin')
@Roles('reviewer', 'admin')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get('review-queue')
  async queue(@Query('kind') kind?: string) {
    return { items: await this.review.queue(kind) };
  }

  @Post('items/:kind/:id/approve')
  @HttpCode(200)
  async approve(@CurrentUser() me: CurrentUserType, @Param('kind') kind: string, @Param('id') id: string) {
    await this.review.approve(kind, id, me.id);
    return { state: 'approved' };
  }

  @Post('items/:kind/:id/reject')
  @HttpCode(200)
  async reject(
    @CurrentUser() me: CurrentUserType,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    await this.review.reject(kind, id, me.id, dto.reason.trim());
    return { state: 'rejected' };
  }

  @Post('items/:kind/:id/remove')
  @HttpCode(200)
  async remove(
    @CurrentUser() me: CurrentUserType,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    await this.review.remove(kind, id, me.id, dto.reason.trim());
    return { state: 'removed' };
  }
}
