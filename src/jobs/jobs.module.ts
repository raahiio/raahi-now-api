import { Inject, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { OutboxRelayService } from '../outbox/outbox-relay.service.js';
import { DropSweeper } from './drop-sweeper.service.js';
import { EventSweeper } from './event-sweeper.service.js';

@Module({
  imports: [ScheduleModule.forRoot(), OutboxModule],
  providers: [DropSweeper, EventSweeper],
  exports: [DropSweeper, EventSweeper],
})
export class JobsModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly names: string[] = [];

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly registry: SchedulerRegistry,
    private readonly drops: DropSweeper,
    private readonly events: EventSweeper,
    private readonly relay: OutboxRelayService,
  ) {}

  /** Timers are registered only when JOBS_ENABLED, so a disabled flag means no timers at all. */
  onModuleInit(): void {
    if (!this.env.JOBS_ENABLED) return;
    this.schedule('drop-sweeper', 60_000, () => this.drops.run());
    this.schedule('event-sweeper', 600_000, () => this.events.run());
    this.schedule('outbox-relay', 5_000, () => this.relay.run());
  }

  onModuleDestroy(): void {
    for (const name of this.names.splice(0)) this.registry.deleteInterval(name);
  }

  private schedule(name: string, ms: number, job: () => Promise<unknown>): void {
    const handle = setInterval(() => {
      job().catch((err: unknown) => {
        this.logger.error(`${name} failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, ms);
    this.registry.addInterval(name, handle);
    this.names.push(name);
  }
}
