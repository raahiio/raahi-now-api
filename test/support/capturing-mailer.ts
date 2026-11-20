import { type MailMessage, Mailer } from '../../src/mail/mailer.js';

/** Records every message instead of sending it. `send` records synchronously when called. */
export class CapturingMailer extends Mailer {
  sent: MailMessage[] = [];
  private pending: Promise<void>[] = [];

  send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
    const done = Promise.resolve();
    this.pending.push(done);
    return done;
  }

  /** Resolves once every send started so far has settled (for fire-and-forget callers). */
  async flush(): Promise<void> {
    await Promise.all(this.pending.splice(0));
  }

  clear(): void {
    this.sent = [];
    this.pending = [];
  }
}
