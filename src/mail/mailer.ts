export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Outbound mail port. */
export abstract class Mailer {
  abstract send(msg: MailMessage): Promise<void>;
}
