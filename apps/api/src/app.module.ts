import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { ErroresFilter } from './common/pg-errors.filter';
import { HealthController } from './health.controller';
import { ObrasController } from './obras/obras.controller';
import { ObrasService } from './obras/obras.service';
import { RequisicionesController } from './requisiciones/requisiciones.controller';
import { RequisicionesService } from './requisiciones/requisiciones.service';
import { AvancesController } from './avances/avances.controller';
import { AvancesService } from './avances/avances.service';
import { SyncController } from './sync/sync.controller';
import { SyncService } from './sync/sync.service';
import { ArchivosController } from './archivos/archivos.controller';
import { ArchivosService } from './archivos/archivos.service';
import { S3Storage, Storage } from './archivos/storage.service';

// Monolito modular: un módulo Nest por ahora; cada carpeta de dominio es
// candidata a su propio módulo cuando crezca.
@Module({
  imports: [DbModule],
  controllers: [
    HealthController, AuthController, ObrasController, RequisicionesController, AvancesController,
    SyncController, ArchivosController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErroresFilter },
    { provide: Storage, useClass: S3Storage },
    ObrasService, RequisicionesService, AvancesService, SyncService, ArchivosService,
  ],
})
export class AppModule {}
