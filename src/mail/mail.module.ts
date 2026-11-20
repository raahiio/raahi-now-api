import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { LogMailer } from './log-mailer.js';
import { Mailer } from './mailer.js';
import { SesMailer } from './ses-mailer.js';

@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      inject: [ENV],
      useFactory: (env: Env): Mailer => (env.NODE_ENV === 'production' ? new SesMailer(env) : new LogMailer()),
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
