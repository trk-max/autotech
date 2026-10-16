import { Module } from '@nestjs/common';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { LaborController } from './labor.controller';
import { LaborService } from './labor.service';

@Module({ imports: [VehiclesModule], controllers: [LaborController], providers: [LaborService] })
export class LaborModule {}
