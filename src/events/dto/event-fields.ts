import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength } from 'class-validator';
import { HttpsNoShortener } from '../../common/validation/decorators.js';
import { idField, text, whole } from '../../drops/dto/drop-fields.js';
import { ADDRESS_VISIBILITIES, EVENT_CATEGORIES } from '../event-state.js';

export { idField, optional, patch, text, whole } from '../../drops/dto/drop-fields.js';

export const category = (): PropertyDecorator =>
  applyDecorators(
    ApiProperty({ type: String, enum: [...EVENT_CATEGORIES] }),
    IsIn([...EVENT_CATEGORIES], { message: 'category.invalid' }),
  );
export const addressVisibility = (): PropertyDecorator =>
  applyDecorators(
    ApiProperty({ type: String, enum: [...ADDRESS_VISIBILITIES] }),
    IsIn([...ADDRESS_VISIBILITIES], { message: 'addressVisibility.invalid' }),
  );
/** Wall-clock string; its format and real-ness are checked against the market zone in the service. */
export const wallClock = (field: string): PropertyDecorator =>
  applyDecorators(
    ApiProperty({
      type: String,
      description: 'Wall-clock time in the market time zone, YYYY-MM-DDTHH:mm',
      example: '2026-11-21T18:30',
    }),
    IsString({ message: `${field}.required` }),
  );
export const link = (): PropertyDecorator =>
  applyDecorators(ApiProperty({ type: String }), IsString({ message: 'link.invalid' }), HttpsNoShortener());

export const nameField = () => text('name', 5, 80, { contact: true });
export const descriptionField = () => text('description', 20, 600);
export const areaField = () => text('area', 2, 80);
export const dateNoteField = () => text('dateNote', 2, 60);
export const exactAddressField = () => text('exactAddress', 5, 160);
export const capacityField = () => whole('capacity', 1, 500);
export const photoField = () => idField('photoMediaId');
export const hostNameField = () => text('hostName', 2, 60, { contact: true });
/** Guest contact email. Never echoed back. A malformed value is `hostEmail.invalid`. */
export const hostEmailField = (): PropertyDecorator =>
  applyDecorators(
    ApiProperty({ type: String, format: 'email', maxLength: 254 }),
    IsString({ message: 'hostEmail.invalid' }),
    MaxLength(254, { message: 'hostEmail.invalid' }),
    IsEmail({}, { message: 'hostEmail.invalid' }),
  );
