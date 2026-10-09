import { Module } from '@nestjs/common';
import { WorkshopsController } from './workshops.controller.js';
import { WorkshopsService } from './workshops.service.js';

@Module({ controllers: [WorkshopsController], providers: [WorkshopsService] })
export class WorkshopsModule {}
