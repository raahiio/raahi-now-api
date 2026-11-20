import {
  addressVisibility,
  areaField,
  capacityField,
  category,
  dateNoteField,
  descriptionField,
  exactAddressField,
  link,
  nameField,
  optional,
  patch,
  photoField,
  wallClock,
} from './event-fields.js';

/** Every field is optional; absent means unchanged, null clears an optional field. marketId is not here: it is locked. */
export class UpdateEventDto {
  @patch(nameField()) name?: string;
  @patch(category()) category?: 'tasting' | 'walk' | 'market' | 'class' | 'gathering';
  @patch(descriptionField()) description?: string;
  @patch(wallClock('startsLocal')) startsLocal?: string;
  @optional(wallClock('endsLocal')) endsLocal?: string | null;
  @optional(dateNoteField()) dateNote?: string | null;
  @patch(areaField()) area?: string;
  @optional(exactAddressField()) exactAddress?: string | null;
  @optional(addressVisibility()) addressVisibility?: 'public' | 'after_rsvp' | null;
  @optional(capacityField()) capacity?: number | null;
  @optional(photoField()) photoMediaId?: string | null;
  @optional(link()) link?: string | null;
}
