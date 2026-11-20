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
  /** Presigns a PUT that only accepts exactly `sizeBytes` bytes of `contentType`. */
  abstract presignPut(key: string, contentType: string, sizeBytes: number): Promise<PresignedPut>;
  /** Size of a stored object, or null when the key does not exist. Never downloads the body. */
  abstract head(key: string): Promise<{ size: number } | null>;
  /** Throws ObjectNotFoundError when the key does not exist. */
  abstract get(key: string): Promise<Buffer>;
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
}
