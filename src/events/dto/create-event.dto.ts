import {
  addressVisibility,
  areaField,
  capacityField,
  category,
  dateNoteField,
  descriptionField,
  exactAddressField,
  idField,
  link,
  nameField,
  optional,
  photoField,
  wallClock,
} from './event-fields.js';

export class CreateEventDto {
  @nameField() name!: string;
  @category() category!: 'tasting' | 'walk' | 'market' | 'class' | 'gathering';
  @idField('marketId') marketId!: string;
  @descriptionField() description!: string;
  @wallClock('startsLocal') startsLocal!: string;
  @optional(wallClock('endsLocal')) endsLocal?: string | null;
  @optional(dateNoteField()) dateNote?: string | null;
  @areaField() area!: string;
  @optional(exactAddressField()) exactAddress?: string | null;
  @optional(addressVisibility()) addressVisibility?: 'public' | 'after_rsvp' | null;
  @optional(capacityField()) capacity?: number | null;
  @optional(photoField()) photoMediaId?: string | null;
  @optional(link()) link?: string | null;
}
