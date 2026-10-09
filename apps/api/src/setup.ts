import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureApp(app: NestExpressApplication) {
  const config = app.get(ConfigService);
  const origins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.enableCors({
    origin: origins,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  const v = config.get<string>('TRUST_PROXY');
  if (v && v !== 'false') {
    app.set('trust proxy', v === 'true' ? 1 : /^\d+$/.test(v) ? Number(v) : v);
  }
}
