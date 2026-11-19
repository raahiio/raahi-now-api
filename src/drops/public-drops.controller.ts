import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Kysely } from 'kysely';
import type { RequestWithUser } from '../auth/current-user.decorator.js';
import { OptionalAuth } from '../auth/roles.decorator.js';
import { applyCacheHeaders } from '../common/cache-headers.js';
import { AppError } from '../common/errors/app-error.js';
import { decodeCursor, encodeCursor, parseLimit } from '../common/pagination.js';
import { DB } from '../db/tokens.js';
import type { Schema } from '../db/schema.js';
import { type DropRow, type DropView, serializeDrop } from './drop.serializer.js';
import { ownerDropQuery } from './owner-view.js';
import { PublicDropsRepository } from './public-drops.repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('drops')
@OptionalAuth()
export class PublicDropsController {
  constructor(
    private readonly repo: PublicDropsRepository,
    @Inject(DB) private readonly db: Kysely<Schema>,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('market') market?: unknown,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ) {
    applyCacheHeaders(req, res);
    const take = parseLimit(limit);
    const after = cursor === undefined ? undefined : decodeCursor(cursor as string);
    const page = await this.repo.list({
      marketId: typeof market === 'string' && market !== '' ? market : undefined,
      limit: take,
      after,
    });
    const now = new Date();
    return {
      items: page.rows.map((r) => serializeDrop(r, 'public', now)),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    };
  }

  @Get(':id')
  async get(
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ): Promise<DropView> {
    applyCacheHeaders(req, res);
    if (!UUID.test(id)) throw new AppError(404, 'not_found');
    const now = new Date();
    const me = req.user;

    // Reviewers and admins read any status; an owner reads their own. Everyone else is public.
    if (me) {
      const reviewer = me.roles.includes('reviewer') || me.roles.includes('admin');
      if (reviewer || me.localId) {
        let q = ownerDropQuery(this.db).where('drops.id', '=', id);
        if (!reviewer) q = q.where('drops.local_id', '=', me.localId as string);
        const row: DropRow | undefined = await q.executeTakeFirst();
        if (row) return serializeDrop(row, reviewer ? 'reviewer' : 'owner', now);
      }
    }

    const row = await this.repo.findLive(id);
    if (!row) throw new AppError(404, 'not_found');
    return serializeDrop(row, 'public', now);
  }
}
