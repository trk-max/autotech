import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { IdParam } from '../common/zod';
import { DbService, applies } from '../db/db.service';

@Controller()
export class ContentController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get('variants/:id/procedures')
  list(@Param('id', IdParam) id: number) {
    return this.db.query(
      `SELECT p.id, p.kind, p.title, p.system::text AS system, p.render_mode AS "renderMode",
              (SELECT count(*)::int FROM torque_spec t WHERE t.procedure_id = p.id) AS "torqueCount"
       FROM procedure p WHERE ${applies('p')} ORDER BY p.kind = 'hv_deactivation' DESC, p.system, p.title`, [id]);
  }

  @Get('procedures/:id')
  async get(@Param('id', IdParam) id: number) {
    const p = await this.db.one(
      `SELECT p.id, p.kind, p.title, p.system::text AS system, p.render_mode AS "renderMode", p.body, p.version, p.language,
              s.name AS "sourceName", s.origin AS "sourceOrigin"
       FROM procedure p JOIN data_source s ON s.id = p.source_id WHERE p.id = $1`, [id]);
    if (!p) throw new NotFoundException('Procédure introuvable');
    const torque = await this.db.query(
      `SELECT t.id, t.fastener, t.stages, t.replace_fastener AS "replaceFastener", t.hotspot FROM torque_spec t WHERE t.procedure_id = $1 ORDER BY t.id`, [id]);
    const tools = await this.db.query(
      `SELECT st.oem_tool_no AS "toolNo", st.name FROM procedure_tool pt JOIN special_tool st ON st.id = pt.tool_id WHERE pt.procedure_id = $1`, [id]);
    return { ...p, torque, tools };
  }
}
