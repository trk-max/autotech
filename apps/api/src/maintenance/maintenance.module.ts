import { Module } from '@nestjs/common';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

@Module({ imports: [VehiclesModule], controllers: [MaintenanceController], providers: [MaintenanceService] })
export class MaintenanceModule {}
