import { ObjectNotFoundError, ObjectStorage, type PresignedPut } from '../../src/media/object-storage.js';

/** In-memory ObjectStorage for tests. */
export class MemoryStorage extends ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  /** Keys passed to get(), in call order. */
  readonly gets: string[] = [];

  async presignPut(key: string, contentType: string, sizeBytes: number): Promise<PresignedPut> {
    return {
      url: `https://storage.test/${key}`,
      headers: { 'Content-Type': contentType, 'Content-Length': String(sizeBytes) },
    };
  }

  async head(key: string): Promise<{ size: number } | null> {
    const found = this.objects.get(key);
    return found ? { size: found.body.length } : null;
  }

  async get(key: string): Promise<Buffer> {
    this.gets.push(key);
    const found = this.objects.get(key);
    if (!found) throw new ObjectNotFoundError(key);
    return found.body;
  }

  /** Forgets all objects and recorded calls. */
  clear(): void {
    this.objects.clear();
    this.gets.length = 0;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  /** Simulates the client's PUT to the presigned URL. */
  seed(mediaId: string, body: Buffer, contentType = 'image/jpeg'): void {
    this.objects.set(`media/${mediaId}/original`, { body, contentType });
  }

  /** Raw bytes of a stored object, e.g. `media/<id>/display.jpg`. */
  read(key: string): Buffer {
    const found = this.objects.get(key);
    if (!found) throw new ObjectNotFoundError(key);
    return found.body;
  }
}
