import { Module } from '@nestjs/common';
import { ClockModule } from './common/clock.js';
import { EventsModule } from './events/events.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { DropsModule } from './drops/drops.module.js';
import { HealthModule } from './health/health.module.js';
import { GuestsModule } from './guests/guests.module.js';
import { MailModule } from './mail/mail.module.js';
import { MarketsModule } from './markets/markets.module.js';
import { MediaModule } from './media/media.module.js';
import { ReviewModule } from './review/review.module.js';
import { MeModule } from './me/me.module.js';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    ClockModule,
    AuthModule,
    HealthModule,
    MarketsModule,
    MeModule,
    MediaModule,
    DropsModule,
    ReviewModule,
    MailModule,
    GuestsModule,
    EventsModule,
  ],
})
export class AppModule {}
