import { Logger } from '@nestjs/common';
import { type MailMessage, Mailer } from './mailer.js';

/** Development mailer. Logs the recipient domain and subject only: bodies carry claim codes. */
export class LogMailer extends Mailer {
  private readonly logger = new Logger('Mailer');

  constructor(private readonly write: (line: string) => void = (line) => this.logger.log(line)) {
    super();
  }

  async send(msg: MailMessage): Promise<void> {
    const domain = msg.to.slice(msg.to.lastIndexOf('@') + 1);
    this.write(`mail to @${domain}: ${msg.subject}`);
  }
}
