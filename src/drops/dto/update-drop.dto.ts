import { costNotBelowMin, idField, optional, patch, standIn, text, whole, windowHours } from './drop-fields.js';

/** Every field is optional; an absent field is left as it is. */
export class UpdateDropDto {
  @patch(text('title', 5, 80, { contact: true, place: 'public' })) title?: string;
  @patch(text('whyNow', 20, 280, { contact: true, place: 'public' })) whyNow?: string;
  @patch(text('perfectFor', 2, 120, { contact: true })) perfectFor?: string;
  @patch(whole('costMinUsd', 0, 1000)) costMinUsd?: number;
  @costNotBelowMin() @patch(whole('costMaxUsd', 0, 1000)) costMaxUsd?: number;
  @patch(whole('timeMinutes', 15, 720, { step: 15 })) timeMinutes?: number;
  @optional(text('bestTime', 2, 60, { contact: true })) bestTime?: string | null;
  @patch(text('watchOut', 5, 200, { contact: true, place: 'public' })) watchOut?: string;
  @patch(idField('photoMediaId')) photoMediaId?: string;
  @standIn() photoIsStandIn?: boolean;
  @patch(idField('marketId')) marketId?: string;
  @patch(text('fuzzyArea', 2, 80, { contact: true, place: 'fuzzy' })) fuzzyArea?: string;
  @patch(text('exactPlace', 5, 160)) exactPlace?: string;
  @optional(text('meetDetail', 5, 280, { contact: true })) meetDetail?: string | null;
  @patch(windowHours()) windowHours?: number;
  @patch(whole('unlocksPerDay', 1, 20)) unlocksPerDay?: number;
  @patch(whole('unlockPriceCredits', 1, 3)) unlockPriceCredits?: number;
}
