import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './setup.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule);
configureApp(app);
app.enableShutdownHooks();
await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'));
