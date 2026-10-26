import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ConfirmarArchivoInput, PrefirmarInput } from '@obraclara/contracts';
import { Sesion } from '../auth/auth.guard';
import type { Tenant } from '../db/db.service';
import { ZodPipe } from '../common/zod.pipe';
import { ArchivosService } from './archivos.service';

@Controller('v1/archivos')
export class ArchivosController {
  constructor(private readonly archivos: ArchivosService) {}

  @Post('prefirmar')
  prefirmar(@Sesion() s: Tenant, @Body(new ZodPipe(PrefirmarInput)) body: PrefirmarInput) {
    return this.archivos.prefirmar(s, body);
  }

  @Post('confirmar')
  @HttpCode(200)
  confirmar(@Sesion() s: Tenant, @Body(new ZodPipe(ConfirmarArchivoInput)) body: ConfirmarArchivoInput) {
    return this.archivos.confirmar(s, body);
  }
}
