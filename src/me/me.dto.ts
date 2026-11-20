import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IANAZone } from 'luxon';
import {
  NoContactDetails,
  PlainText,
  TextRange,
} from '../common/validation/decorators.js';
import {
  isValidHandle,
  normalizeHandle,
  type Platform,
} from '../common/validation/handles.js';

/** Normalizes then validates; '' or null (remove the handle) pass through. */
function Handle(platform: Platform): PropertyDecorator {
  const normalize = Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeHandle(value) : value,
  );
  const validate = ValidateBy({
    name: 'socialHandle',
    validator: {
      validate: (v: unknown) =>
        v === null ||
        v === '' ||
        (typeof v === 'string' && isValidHandle(platform, v)),
      defaultMessage: () => `socials.${platform}.invalid`,
    },
  });
  const doc = ApiProperty({ type: String, required: false, nullable: true, description: "Handle; '' or null removes it" });
  return (object, property) => {
    doc(object, property);
    normalize(object, property);
    validate(object, property);
  };
}

export class SocialsDto {
  @IsOptional() @Handle('instagram') instagram?: string | null;
  @IsOptional() @Handle('threads') threads?: string | null;
  @IsOptional() @Handle('x') x?: string | null;
  @IsOptional() @Handle('tiktok') tiktok?: string | null;
  @IsOptional() @Handle('youtube') youtube?: string | null;
}

export class UpdateMeDto {
  @ApiProperty({ type: String, required: false, minLength: 2, maxLength: 60 })
  @ValidateIf((_, v) => v !== undefined)
  @IsString({ message: 'firstName.required' })
  @PlainText('firstName.required')
  @NoContactDetails()
  @TextRange(2, 60, 'firstName')
  firstName?: string;

  @ApiProperty({ type: String, required: false, description: 'IANA time zone', example: 'Asia/Colombo' })
  @ValidateIf((_, v) => v !== undefined)
  @ValidateBy({
    name: 'isTimeZone',
    validator: {
      validate: (v: unknown) =>
        typeof v === 'string' && IANAZone.isValidZone(v),
      defaultMessage: () => 'tz.invalid',
    },
  })
  tz?: string;

  @ApiProperty({ type: () => SocialsDto, required: false })
  @IsOptional()
  @IsObject({ message: 'socials.invalid' })
  @ValidateNested()
  @Type(() => SocialsDto)
  socials?: SocialsDto;
}
