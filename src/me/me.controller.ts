import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUser as CurrentUserType,
} from '../auth/current-user.decorator.js';
import { RequireAuth } from '../auth/roles.decorator.js';
import { UsersService, type UserWithLocal } from '../auth/users.service.js';
import { UpdateMeDto } from './me.dto.js';

@Controller('me')
@RequireAuth()
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async get(@CurrentUser() me: CurrentUserType) {
    return this.view(await this.users.getWithLocal(me.id), me);
  }

  @Patch()
  async patch(@CurrentUser() me: CurrentUserType, @Body() dto: UpdateMeDto) {
    await this.users.updateProfile(me.id, {
      firstName: dto.firstName,
      tz: dto.tz,
      socials: dto.socials
        ? (Object.fromEntries(Object.entries(dto.socials)) as Record<
            string,
            string | null
          >)
        : undefined,
    });
    return this.view(await this.users.getWithLocal(me.id), me);
  }

  private view({ user, local }: UserWithLocal, me: CurrentUserType) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      emailVerified: user.email_verified,
      tz: user.tz,
      socials: user.socials,
      roles: me.roles,
      localId: local?.id ?? null,
    };
  }
}
