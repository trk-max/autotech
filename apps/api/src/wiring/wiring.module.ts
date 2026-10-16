import { Module } from '@nestjs/common';
import { WiringController } from './wiring.controller';
import { WiringService } from './wiring.service';

@Module({ controllers: [WiringController], providers: [WiringService], exports: [WiringService] })
export class WiringModule {}
