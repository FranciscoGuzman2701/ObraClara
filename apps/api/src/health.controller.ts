import { Controller, Get } from '@nestjs/common';
import { Publico } from './auth/auth.guard';
import { DbService } from './db/db.service';

@Controller('v1/health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Publico()
  @Get()
  async health() {
    const db = await this.db.sistema((c) => c.query('SELECT 1').then(() => 'ok')).catch(() => 'error');
    return { status: db === 'ok' ? 'ok' : 'degradado', db };
  }
}
