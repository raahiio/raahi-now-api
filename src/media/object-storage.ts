export class ObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
}

/** Binary object store. The production implementation is S3; tests use an in-memory fake. */
export abstract class ObjectStorage {
  abstract presignPut(key: string, contentType: string): Promise<PresignedPut>;
  /** Throws ObjectNotFoundError when the key does not exist. */
  abstract get(key: string): Promise<Buffer>;
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
}
