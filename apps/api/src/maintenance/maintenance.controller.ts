import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { IdParam, ZodPipe } from '../common/zod';
import { MaintenanceService } from './maintenance.service';

const Km = new ZodPipe(z.coerce.number().int().min(0).max(2_000_000).default(0));
const Age = new ZodPipe(z.coerce.number().int().min(0).max(600).default(0));

@Controller()
export class MaintenanceController {
  constructor(@Inject(MaintenanceService) private readonly svc: MaintenanceService) {}

  @Get('variants/:id/maintenance')
  schedule(@Param('id', IdParam) id: number, @Query('km', Km) km: number, @Query('ageMonths', Age) age: number) {
    return this.svc.schedule(id, km, age);
  }

  @Get('variants/:id/maintenance/checklist.pdf')
  async pdf(
    @Param('id', IdParam) id: number, @Query('km', Km) km: number, @Query('ageMonths', Age) age: number,
    @Query('plate', new ZodPipe(z.string().max(20).nullish())) plate: string | null | undefined, @Res() res: Response,
  ) {
    const buf = await this.svc.checklistPdf(id, km, age, plate ?? null);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="fiche-entretien.pdf"');
    res.send(buf);
  }
}
