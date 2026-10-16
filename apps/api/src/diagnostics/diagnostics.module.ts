import { Module } from '@nestjs/common';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { WiringModule } from '../wiring/wiring.module';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

@Module({ imports: [VehiclesModule, WiringModule], controllers: [DiagnosticsController], providers: [DiagnosticsService] })
export class DiagnosticsModule {}
