import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { ObjectNotFoundError, ObjectStorage, type PresignedPut } from './object-storage.js';

const PRESIGN_TTL_SECONDS = 15 * 60;

@Injectable()
export class S3Storage extends ObjectStorage {
  private client?: S3Client;

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
  }

  /** Built on first use so apps and tests that never touch S3 never construct a client. */
  private s3(): S3Client {
    return (this.client ??= new S3Client({ region: this.env.S3_REGION }));
  }

  async presignPut(key: string, contentType: string, sizeBytes: number): Promise<PresignedPut> {
    // Content-Length is signed, so S3 refuses a PUT of any other size.
    const command = new PutObjectCommand({
      Bucket: this.env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    const url = await getSignedUrl(this.s3(), command, {
      expiresIn: PRESIGN_TTL_SECONDS,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return { url, headers: { 'Content-Type': contentType, 'Content-Length': String(sizeBytes) } };
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.s3().send(new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      const res = await this.s3().send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') throw new ObjectNotFoundError(key);
      throw err;
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3().send(
      new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
    );
  }
}
