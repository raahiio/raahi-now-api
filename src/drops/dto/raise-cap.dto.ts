import { whole } from './drop-fields.js';

export class RaiseCapDto {
  @whole('unlocksPerDay', 1, 20) unlocksPerDay!: number;
}
