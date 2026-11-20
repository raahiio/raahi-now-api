import { Clock } from '../../src/common/clock.js';

/** Follows the system time until a test calls `set`, then stays frozen at that instant. */
export class FixedClock extends Clock {
  private fixed: Date | null = null;

  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }

  set(date: Date | string): void {
    this.fixed = new Date(date);
  }

  reset(): void {
    this.fixed = null;
  }
}
