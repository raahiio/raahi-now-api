import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';
import { RateLimiter } from '../common/rate-limit.js';
import { AppError, ValidationFailedError } from '../common/errors/app-error.js';
import { messageFor } from '../common/errors/messages.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { hashKey } from '../common/device.js';
import type { Schema } from '../db/schema.js';
import { DB } from '../db/tokens.js';
import { ImageProcessor } from './image-processor.js';
import { MAX_IMAGE_BYTES } from './media.dto.js';
import { ObjectNotFoundError, ObjectStorage } from './object-storage.js';

const UPLOADS_PER_HOUR = 20;
const HOUR_SECONDS = 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who is asking: a signed-in user id, or a hashed device id for guests. */
export type MediaCaller = { userId: string } | { deviceHash: string };

export interface CompletedMedia {
  id: string;
  status: 'ready';
  width: number;
  height: number;
}

/** Every image problem uses the 422 validation_failed shape, with the issue on field `file`. */
const fileError = (code: string) =>
  new ValidationFailedError([{ code, field: 'file', message: messageFor(code) }]);

const originalKey = (id: string) => `media/${id}/original`;
const displayKey = (id: string) => `media/${id}/display.jpg`;

@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Schema>,
    @Inject(ENV) private readonly env: Env,
    private readonly storage: ObjectStorage,
    private readonly processor: ImageProcessor,
    private readonly limiter: RateLimiter,
  ) {}

  async createUpload(caller: MediaCaller, contentType: string) {
    const rateKey = 'userId' in caller ? hashKey(`user:${caller.userId}`, this.env.DEVICE_HASH_SALT) : caller.deviceHash;
    await this.limiter.hit('media_upload', rateKey, UPLOADS_PER_HOUR, HOUR_SECONDS);

    const id = uuidv7();
    const upload = await this.storage.presignPut(originalKey(id), contentType);
    await this.db
      .insertInto('media')
      .values({
        id,
        owner_user_id: 'userId' in caller ? caller.userId : null,
        owner_device_hash: 'deviceHash' in caller ? caller.deviceHash : null,
        content_type: contentType,
        s3_key: originalKey(id),
        status: 'pending',
      })
      .execute();
    return { mediaId: id, upload: { method: 'PUT' as const, url: upload.url, headers: upload.headers } };
  }

  async complete(caller: MediaCaller, id: string): Promise<CompletedMedia> {
    const row = UUID.test(id)
      ? await this.db.selectFrom('media').selectAll().where('id', '=', id).executeTakeFirst()
      : undefined;
    const owned =
      row &&
      ('userId' in caller ? row.owner_user_id === caller.userId : row.owner_device_hash === caller.deviceHash);
    if (!row || !owned) throw new AppError(404, 'not_found');

    if (row.status === 'ready') return this.view(row.id, row.width!, row.height!);
    if (row.status === 'rejected') throw new AppError(409, 'media.not_pending');

    let original: Buffer;
    try {
      original = await this.storage.get(originalKey(id));
    } catch (err) {
      if (err instanceof ObjectNotFoundError) throw fileError('photo.not_ready');
      throw err;
    }

    try {
      if (original.length > MAX_IMAGE_BYTES) throw new AppError(422, 'image.too_large', 'file');
      const image = await this.processor.process(original);
      await this.storage.put(displayKey(id), image.output, image.contentType);
      await this.db
        .updateTable('media')
        .set({ status: 'ready', s3_key: displayKey(id), content_type: image.contentType, width: image.width, height: image.height })
        .where('id', '=', id)
        .where('status', '=', 'pending')
        .execute();
      return this.view(id, image.width, image.height);
    } catch (err) {
      if (err instanceof AppError && err.status === 422 && err.field === 'file') {
        await this.db
          .updateTable('media')
          .set({ status: 'rejected', reject_code: err.code })
          .where('id', '=', id)
          .where('status', '=', 'pending')
          .execute();
        throw fileError(err.code);
      }
      throw err;
    }
  }

  private view(id: string, width: number, height: number): CompletedMedia {
    return { id, status: 'ready', width, height };
  }
}
