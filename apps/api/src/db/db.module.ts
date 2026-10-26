import { Global, Module } from '@nestjs/common';
import { CONFIG, cargarConfig } from '../config';
import { DbService } from './db.service';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: cargarConfig }, DbService],
  exports: [CONFIG, DbService],
})
export class DbModule {}
