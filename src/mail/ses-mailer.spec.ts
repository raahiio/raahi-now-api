import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { LogMailer } from './log-mailer.js';
import { SesMailer } from './ses-mailer.js';

const send = vi.fn();
const configs: unknown[] = [];
vi.mock('@aws-sdk/client-sesv2', async (orig) => {
  const actual = await orig<typeof import('@aws-sdk/client-sesv2')>();
  return {
    ...actual,
    SESv2Client: class {
      send = send;
      constructor(config: unknown) {
        configs.push(config);
      }
    },
  };
});

describe('SesMailer', () => {
  it('sends one SendEmail command with from, to, subject and text', async () => {
    send.mockResolvedValue({});
    const mailer = new SesMailer({ SES_FROM: 'no-reply@raahi.test', S3_REGION: 'ap-south-1' });
    await mailer.send({ to: 'guest@example.com', subject: 'Hello', text: 'Body text' });
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]![0] as SendEmailCommand;
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toMatchObject({
      FromEmailAddress: 'no-reply@raahi.test',
      Destination: { ToAddresses: ['guest@example.com'] },
      Content: { Simple: { Subject: { Data: 'Hello' }, Body: { Text: { Data: 'Body text' } } } },
    });
  });
});

describe('SesMailer region', () => {
  beforeEach(() => {
    configs.length = 0;
    send.mockResolvedValue({});
  });
  const msg = { to: 'guest@example.com', subject: 'Hi', text: 'Body' };

  it('uses SES_REGION when set', async () => {
    await new SesMailer({ SES_FROM: 'a@raahi.test', S3_REGION: 'ap-south-1', SES_REGION: 'us-east-1' }).send(msg);
    expect(configs).toEqual([{ region: 'us-east-1' }]);
  });

  it('falls back to S3_REGION', async () => {
    await new SesMailer({ SES_FROM: 'a@raahi.test', S3_REGION: 'ap-south-1' }).send(msg);
    expect(configs).toEqual([{ region: 'ap-south-1' }]);
  });
});

describe('LogMailer', () => {
  it('logs only the recipient domain and subject, never the body', async () => {
    const lines: string[] = [];
    const mailer = new LogMailer((line) => lines.push(line));
    await mailer.send({ to: 'guest@example.com', subject: 'Your code', text: 'ABCDEFGH2345' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('example.com');
    expect(lines[0]).toContain('Your code');
    expect(lines[0]).not.toContain('guest');
    expect(lines[0]).not.toContain('ABCDEFGH2345');
  });
});
