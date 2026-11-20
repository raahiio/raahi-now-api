import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { Env } from '../config/env.js';
import { type MailMessage, Mailer } from './mailer.js';

export class SesMailer extends Mailer {
  private client?: SESv2Client;

  constructor(private readonly env: Pick<Env, 'SES_FROM'>) {
    super();
  }

  /** Built on first use so apps that never send mail never construct a client. */
  private ses(): SESv2Client {
    return (this.client ??= new SESv2Client({}));
  }

  async send(msg: MailMessage): Promise<void> {
    await this.ses().send(
      new SendEmailCommand({
        FromEmailAddress: this.env.SES_FROM,
        Destination: { ToAddresses: [msg.to] },
        Content: { Simple: { Subject: { Data: msg.subject }, Body: { Text: { Data: msg.text } } } },
      }),
    );
  }
}
