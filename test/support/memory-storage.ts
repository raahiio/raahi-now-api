import { ObjectNotFoundError, ObjectStorage, type PresignedPut } from '../../src/media/object-storage.js';

/** In-memory ObjectStorage for tests. */
export class MemoryStorage extends ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async presignPut(key: string, contentType: string): Promise<PresignedPut> {
    return { url: `https://storage.test/${key}`, headers: { 'Content-Type': contentType } };
  }

  async get(key: string): Promise<Buffer> {
    const found = this.objects.get(key);
    if (!found) throw new ObjectNotFoundError(key);
    return found.body;
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
