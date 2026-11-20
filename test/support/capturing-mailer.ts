import { type MailMessage, Mailer } from '../../src/mail/mailer.js';

/** Records every message instead of sending it. */
export class CapturingMailer extends Mailer {
  sent: MailMessage[] = [];

  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
  }

  clear(): void {
    this.sent = [];
  }
}
