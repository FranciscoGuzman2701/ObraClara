import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PushInput } from '@obraclara/contracts';
import { Sesion } from '../auth/auth.guard';
import type { Tenant } from '../db/db.service';
import { ZodPipe } from '../common/zod.pipe';
import { SyncService } from './sync.service';

@Controller('v1/sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('push')
  @HttpCode(200)
  async push(@Sesion() s: Tenant, @Body(new ZodPipe(PushInput)) body: PushInput) {
    return { resultados: await this.sync.push(s, body.comandos) };
  }

  @Get('pull/:obraId')
  pull(@Sesion() s: Tenant, @Param('obraId', ParseUUIDPipe) obraId: string) {
    return this.sync.pull(s, obraId);
  }
}
