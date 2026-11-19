import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { MarketsModule } from './markets/markets.module.js';
import { MediaModule } from './media/media.module.js';
import { MeModule } from './me/me.module.js';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    AuthModule,
    HealthModule,
    MarketsModule,
    MeModule,
    MediaModule,
  ],
})
export class AppModule {}
