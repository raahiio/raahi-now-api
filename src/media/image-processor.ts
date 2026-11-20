import { Injectable } from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';
import { AppError } from '../common/errors/app-error.js';

export const MIN_SHORT_SIDE = 800;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export interface ProcessedImage {
  output: Buffer;
  width: number;
  height: number;
  contentType: 'image/jpeg';
}

@Injectable()
export class ImageProcessor {
  /**
   * Detects the real format from the bytes (never the declared content type), applies the EXIF
   * orientation, and re-encodes to JPEG. sharp drops all metadata (EXIF, GPS, ICC) unless asked
   * to keep it, so the output carries none.
   */
  async process(input: Buffer): Promise<ProcessedImage> {
    let meta: Metadata;
    try {
      meta = await sharp(input).metadata();
    } catch {
      throw new AppError(422, 'image.type', 'file');
    }
    if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
      throw new AppError(422, 'image.type', 'file');
    }

    try {
      const { data, info } = await sharp(input)
        .rotate()
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      if (Math.min(info.width, info.height) < MIN_SHORT_SIDE) {
        throw new AppError(422, 'image.too_small', 'file');
      }
      return { output: data, width: info.width, height: info.height, contentType: 'image/jpeg' };
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Corrupt or truncated data that sharp could not decode.
      throw new AppError(422, 'image.type', 'file');
    }
  }
}
