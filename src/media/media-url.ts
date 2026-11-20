/** Options every serializer accepts. */
export interface SerializeOptions {
  /** Public base URL of the media bucket or CDN (MEDIA_BASE_URL). Without it, views carry no photo URL. */
  mediaBaseUrl?: string;
}

/** `${base}/media/<id>/display.jpg`, or undefined when no base is configured. */
export function displayUrl(mediaId: string, base: string | undefined): string | undefined {
  return base ? `${base.replace(/\/+$/, '')}/media/${mediaId}/display.jpg` : undefined;
}
