import { Module } from '@nestjs/common';
import { RateLimiter } from '../common/rate-limit.js';
import { ImageProcessor } from './image-processor.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { ObjectStorage } from './object-storage.js';
import { S3Storage } from './s3-storage.js';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    ImageProcessor,
    RateLimiter,
    { provide: ObjectStorage, useClass: S3Storage },
  ],
  exports: [MediaService, RateLimiter, ObjectStorage],
})
export class MediaModule {}
