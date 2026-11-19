import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AuthGuard } from './auth.guard.js';
import { FirebaseTokenVerifier } from './firebase-token-verifier.js';
import { IdTokenVerifier } from './id-token-verifier.js';
import { RolesGuard } from './roles.guard.js';
import { UsersService } from './users.service.js';

@Module({
  providers: [
    UsersService,
    {
      provide: IdTokenVerifier,
      inject: [ENV],
      useFactory: (env: Env) =>
        new FirebaseTokenVerifier(env.FIREBASE_PROJECT_ID),
    },
    // Order matters: authentication runs before role checks.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [UsersService, IdTokenVerifier],
})
export class AuthModule {}
