import { IsIn, IsInt, Max, Min } from 'class-validator';

export const MAX_IMAGE_BYTES = 5_242_880;
export const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export class CreateUploadDto {
  @IsIn(ALLOWED_CONTENT_TYPES, { message: 'image.type' })
  contentType!: (typeof ALLOWED_CONTENT_TYPES)[number];

  @IsInt({ message: 'sizeBytes.required' })
  @Min(1, { message: 'sizeBytes.range' })
  @Max(MAX_IMAGE_BYTES, { message: 'image.too_large' })
  sizeBytes!: number;
}
