import { costNotBelowMin, idField, optional, standIn, text, whole, windowHours } from './drop-fields.js';

export class CreateDropDto {
  @text('title', 5, 80, { contact: true, place: 'public' }) title!: string;
  @text('whyNow', 20, 280, { contact: true, place: 'public' }) whyNow!: string;
  @text('perfectFor', 2, 120, { contact: true }) perfectFor!: string;
  @whole('costMinUsd', 0, 1000) costMinUsd!: number;
  @costNotBelowMin() @whole('costMaxUsd', 0, 1000) costMaxUsd!: number;
  @whole('timeMinutes', 15, 720, { step: 15 }) timeMinutes!: number;
  @optional(text('bestTime', 2, 60, { contact: true })) bestTime?: string | null;
  @text('watchOut', 5, 200, { contact: true, place: 'public' }) watchOut!: string;
  @idField('photoMediaId') photoMediaId!: string;
  @standIn() photoIsStandIn?: boolean;
  @idField('marketId') marketId!: string;
  @text('fuzzyArea', 2, 80, { contact: true, place: 'fuzzy' }) fuzzyArea!: string;
  @text('exactPlace', 5, 160) exactPlace!: string;
  @optional(text('meetDetail', 5, 280, { contact: true })) meetDetail?: string | null;
  @windowHours() windowHours!: number;
  @whole('unlocksPerDay', 1, 20) unlocksPerDay!: number;
  @whole('unlockPriceCredits', 1, 3) unlockPriceCredits!: number;
}
