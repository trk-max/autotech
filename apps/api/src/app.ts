import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { ErrorsFilter } from './common/errors.filter';

export async function createApp(opts: { logger?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: opts.logger === false ? false : ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ErrorsFilter());
  app.enableCors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] });
  app.enableShutdownHooks();
  return app;
}
