import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Max, Min } from 'class-validator';

export const MAX_IMAGE_BYTES = 5_242_880;
export const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export class CreateUploadDto {
  @ApiProperty({ type: String, enum: [...ALLOWED_CONTENT_TYPES] })
  @IsIn(ALLOWED_CONTENT_TYPES, { message: 'image.type' })
  contentType!: (typeof ALLOWED_CONTENT_TYPES)[number];

  @ApiProperty({ type: Number, minimum: 1, maximum: MAX_IMAGE_BYTES, description: 'Exact size of the file; the upload URL only accepts this many bytes' })
  @IsInt({ message: 'sizeBytes.required' })
  @Min(1, { message: 'sizeBytes.range' })
  @Max(MAX_IMAGE_BYTES, { message: 'image.too_large' })
  sizeBytes!: number;
}
