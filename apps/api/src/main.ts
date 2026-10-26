import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CONFIG, Config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<Config>(CONFIG);
  app.enableCors({ origin: config.corsOrigins });
  app.enableShutdownHooks();
  await app.listen(config.port);
  console.log(`ObraClara API escuchando en http://localhost:${config.port}`);
}

void bootstrap();
