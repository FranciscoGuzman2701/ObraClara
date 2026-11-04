import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AnularChecadaInput, ChecadaInput, CorreccionInput, CrearCentroInput, CrearPeriodoInput, CrearTrabajadorInput,
  KioscoChecadaInput, LoteChecadasInput, RespuestaPeriodoInput,
} from '@obraclara/contracts';
import { Sesion } from '../auth/auth.guard';
import type { Tenant } from '../db/db.service';
import { ZodPipe } from '../common/zod.pipe';
import { ChecadorService } from './checador.service';

const FechaQuery = z.iso.date().optional();

/**
 * Checador digital. Todo opera sobre la empresa del token: para ver o registrar
 * en otra empresa del grupo, primero POST /v1/auth/cambiar-empresa.
 */
@Controller('v1')
export class ChecadorController {
  constructor(private readonly checador: ChecadorService) {}

  // ---------------------------------------------- trabajador
  @Get('checador/mi-dia')
  miDia(@Sesion() s: Tenant) {
    return this.checador.miDia(s);
  }

  @Post('checador/checadas')
  checar(@Sesion() s: Tenant, @Body(new ZodPipe(ChecadaInput)) body: ChecadaInput) {
    return this.checador.checar(s, body);
  }

  @Post('checador/checadas/lote')
  @HttpCode(200)
  async lote(@Sesion() s: Tenant, @Body(new ZodPipe(LoteChecadasInput)) body: LoteChecadasInput) {
    return { resultados: await this.checador.lote(s, body) };
  }

  @Get('checador/mis-periodos')
  misPeriodos(@Sesion() s: Tenant) {
    return this.checador.misPeriodos(s);
  }

  @Post('checador/periodos/:id/respuesta')
  @HttpCode(200)
  responder(
    @Sesion() s: Tenant,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RespuestaPeriodoInput)) body: RespuestaPeriodoInput,
  ) {
    return this.checador.responderPeriodo(s, id, body);
  }

  // ---------------------------------------------- kiosco
  @Post('checador/kiosco')
  kiosco(@Sesion() s: Tenant, @Body(new ZodPipe(KioscoChecadaInput)) body: KioscoChecadaInput) {
    return this.checador.kiosco(s, body);
  }

  // ---------------------------------------------- supervisión
  @Get('checador/tablero')
  tablero(@Sesion() s: Tenant, @Query('fecha', new ZodPipe(FechaQuery)) fecha?: string) {
    return this.checador.tablero(s, fecha);
  }

  @Post('checador/correcciones')
  corregir(@Sesion() s: Tenant, @Body(new ZodPipe(CorreccionInput)) body: CorreccionInput) {
    return this.checador.corregir(s, body);
  }

  @Post('checador/checadas/:id/anular')
  @HttpCode(200)
  anular(
    @Sesion() s: Tenant,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(AnularChecadaInput)) body: z.infer<typeof AnularChecadaInput>,
  ) {
    return this.checador.anular(s, id, body.motivo);
  }

  @Get('checador/trabajadores')
  trabajadores(@Sesion() s: Tenant) {
    return this.checador.trabajadores(s);
  }

  @Post('checador/trabajadores')
  crearTrabajador(@Sesion() s: Tenant, @Body(new ZodPipe(CrearTrabajadorInput)) body: CrearTrabajadorInput) {
    return this.checador.crearTrabajador(s, body);
  }

  @Get('checador/centros')
  centros(@Sesion() s: Tenant) {
    return this.checador.centros(s);
  }

  @Post('checador/centros')
  crearCentro(@Sesion() s: Tenant, @Body(new ZodPipe(CrearCentroInput)) body: CrearCentroInput) {
    return this.checador.crearCentro(s, body);
  }

  @Get('checador/periodos')
  periodos(@Sesion() s: Tenant) {
    return this.checador.periodos(s);
  }

  @Post('checador/periodos')
  crearPeriodo(@Sesion() s: Tenant, @Body(new ZodPipe(CrearPeriodoInput)) body: CrearPeriodoInput) {
    return this.checador.crearPeriodo(s, body);
  }

  @Get('checador/periodos/:id')
  detallePeriodo(@Sesion() s: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.checador.detallePeriodo(s, id);
  }

  @Post('checador/periodos/:id/cerrar')
  @HttpCode(200)
  cerrarPeriodo(@Sesion() s: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    return this.checador.cerrarPeriodo(s, id);
  }

  // ---------------------------------------------- grupo (las 5 empresas)
  @Get('grupo/asistencia')
  grupo(@Sesion() s: Tenant) {
    return this.checador.grupo(s);
  }
}
