import { Controller, Get, Inject, Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { DbService } from './db/db.service';
import { VehiclesModule } from './vehicles/vehicles.module';
import { WiringModule } from './wiring/wiring.module';
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { LaborModule } from './labor/labor.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { ContentModule } from './content/content.module';

@Controller()
class HealthController {
  constructor(@Inject(DbService) private readonly db: DbService) {}
  @Get('health')
  async health() {
    const r = await this.db.one(`SELECT (SELECT count(*)::int FROM vehicle_variant) AS variants, (SELECT max(name) FROM schema_migrations) AS migration`);
    return { status: 'ok', ...r };
  }
}

@Module({
  imports: [DbModule, VehiclesModule, WiringModule, DiagnosticsModule, LaborModule, MaintenanceModule, ContentModule],
  controllers: [HealthController],
})
export class AppModule {}
