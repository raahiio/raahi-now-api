import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, ValidateBy } from 'class-validator';

const MIN_REASON = 5;
const MAX_REASON = 500;

/** Body of reject and remove. The message of every failure is the error code. */
export class ReasonDto {
  @ApiProperty({ type: String, minLength: MIN_REASON, maxLength: MAX_REASON, description: 'Shown to the poster' })
  @IsString({ message: 'review.reason_required' })
  @ValidateBy({
    name: 'reasonLength',
    validator: {
      validate: (v: unknown) => typeof v !== 'string' || Array.from(v.trim()).length >= MIN_REASON,
      defaultMessage: () => 'review.reason_required',
    },
  })
  @MaxLength(MAX_REASON, { message: 'review.reason_too_long' })
  reason!: string;
}
