import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  AutorizarExcepcionInput, CrearRequisicionInput, ValidarLineaInput,
} from '@obraclara/contracts';
import { Sesion } from '../auth/auth.guard';
import type { Tenant } from '../db/db.service';
import { ZodPipe } from '../common/zod.pipe';
import { RequisicionesService } from './requisiciones.service';

@Controller('v1')
export class RequisicionesController {
  constructor(private readonly reqs: RequisicionesService) {}

  @Post('requisiciones/validar')
  @HttpCode(200)
  validar(@Sesion() s: Tenant, @Body(new ZodPipe(ValidarLineaInput)) body: ValidarLineaInput) {
    return this.reqs.validar(s, body);
  }

  @Post('requisiciones')
  crear(@Sesion() s: Tenant, @Body(new ZodPipe(CrearRequisicionInput)) body: CrearRequisicionInput) {
    return this.reqs.crear(s, body);
  }

  @Get('obras/:obraId/requisiciones')
  listar(@Sesion() s: Tenant, @Param('obraId', ParseUUIDPipe) obraId: string) {
    return this.reqs.listar(s, obraId);
  }

  @Get('requisiciones/:id')
  detalle(@Sesion() s: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.reqs.detalle(s, id);
  }

  @Post('requisiciones/:id/enviar')
  @HttpCode(200)
  enviar(@Sesion() s: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.reqs.enviar(s, id);
  }

  @Post('requisiciones/:id/devolver')
  @HttpCode(200)
  devolver(@Sesion() s: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.reqs.devolver(s, id);
  }

  @Post('requisiciones/:id/excepciones')
  @HttpCode(200)
  autorizarExcepcion(
    @Sesion() s: Tenant,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(AutorizarExcepcionInput)) body: z.infer<typeof AutorizarExcepcionInput>,
  ) {
    return this.reqs.autorizarExcepcion(s, id, body.requisicion_linea_id, body.justificacion);
  }

  @Post('requisiciones/:id/aprobar')
  @HttpCode(200)
  aprobar(@Sesion() s: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.reqs.aprobar(s, id);
  }
}
