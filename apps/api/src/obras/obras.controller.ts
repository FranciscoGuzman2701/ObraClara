import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Sesion } from '../auth/auth.guard';
import type { Tenant } from '../db/db.service';
import { ObrasService } from './obras.service';

@Controller('v1/obras')
export class ObrasController {
  constructor(private readonly obras: ObrasService) {}

  @Get()
  listar(@Sesion() s: Tenant) {
    return this.obras.listar(s);
  }

  @Get(':id/presupuesto')
  presupuesto(@Sesion() s: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.obras.presupuesto(s, id);
  }

  @Get(':id/kpis')
  kpis(@Sesion() s: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.obras.kpis(s, id);
  }
}
