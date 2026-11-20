import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';

const email = (): PropertyDecorator =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)),
    IsString({ message: 'email.required' }),
    MaxLength(254, { message: 'email.invalid' }),
    IsEmail({}, { message: 'email.invalid' }),
  );

export class ExchangeClaimDto {
  @IsString({ message: 'code.required' }) code!: string;
}

export class RecoverClaimDto {
  @email() email!: string;
}
