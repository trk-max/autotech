import { Controller, Get, Inject, NotImplementedException, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { IdParam, ZodPipe } from '../common/zod';
import { VehiclesService } from './vehicles.service';

@Controller()
export class VehiclesController {
  constructor(@Inject(VehiclesService) private readonly svc: VehiclesService) {}

  @Get('vehicles/tree')
  tree() { return this.svc.tree(); }

  @Get('search')
  search(@Query('q', new ZodPipe(z.string().max(80).default(''))) q: string) { return this.svc.search(q); }

  @Get('vehicles/vin/:vin')
  vin(@Param('vin', new ZodPipe(z.string().min(1).max(40))) vin: string) { return this.svc.decode(vin); }

  @Get('vehicles/plate/:country/:plate')
  plate() {
    throw new NotImplementedException({
      message: "Recherche par immatriculation : aucun fournisseur configuré. Branchez une API d'immatriculation sous licence (voir README).",
    });
  }

  @Get('variants/:id')
  variant(@Param('id', IdParam) id: number) { return this.svc.variantDetail(id); }
}
