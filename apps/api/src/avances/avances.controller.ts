import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CrearAvanceInput } from '@obraclara/contracts';
import { Sesion } from '../auth/auth.guard';
import type { Tenant } from '../db/db.service';
import { ZodPipe } from '../common/zod.pipe';
import { AvancesService } from './avances.service';

const RechazoInput = z.object({ motivo: z.string().trim().min(3).max(500) });
const EstadoQuery = z.enum(['CAPTURADO', 'VALIDADO', 'RECHAZADO']).optional();

@Controller('v1')
export class AvancesController {
  constructor(private readonly avances: AvancesService) {}

  @Post('obras/:obraId/avances')
  crear(
    @Sesion() s: Tenant,
    @Param('obraId', ParseUUIDPipe) obraId: string,
    @Body(new ZodPipe(CrearAvanceInput)) body: CrearAvanceInput,
  ) {
    return this.avances.crear(s, obraId, body);
  }

  @Get('obras/:obraId/avances')
  listar(
    @Sesion() s: Tenant,
    @Param('obraId', ParseUUIDPipe) obraId: string,
    @Query('estado', new ZodPipe(EstadoQuery)) estado?: string,
  ) {
    return this.avances.listar(s, obraId, estado);
  }

  @Post('avances/:id/validar')
  @HttpCode(200)
  validar(@Sesion() s: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.avances.validar(s, id);
  }

  @Post('avances/:id/rechazar')
  @HttpCode(200)
  rechazar(
    @Sesion() s: Tenant,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RechazoInput)) body: z.infer<typeof RechazoInput>,
  ) {
    return this.avances.rechazar(s, id, body.motivo);
  }
}
