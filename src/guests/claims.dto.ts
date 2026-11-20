import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';

const email = (): PropertyDecorator =>
  applyDecorators(
    ApiProperty({ type: String, format: 'email', maxLength: 254 }),
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)),
    IsString({ message: 'email.required' }),
    MaxLength(254, { message: 'email.invalid' }),
    IsEmail({}, { message: 'email.invalid' }),
  );

export class ExchangeClaimDto {
  @ApiProperty({ type: String, description: '12-character claim code' })
  @IsString({ message: 'code.required' })
  code!: string;
}

export class RecoverClaimDto {
  @email() email!: string;
}
