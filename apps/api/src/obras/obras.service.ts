import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { ConceptoPresupuesto, KpiObra, ObraResumen } from '@obraclara/contracts';
import { DbService, Tenant } from '../db/db.service';
import { exigirRol } from '../common/roles';

// Roles que pueden ver importes ($). Cabo y almacén ven cantidades.
export const VEN_IMPORTES = ['RESIDENTE', 'GERENTE_OBRA', 'COMPRAS', 'FINANZAS'] as const;

@Injectable()
export class ObrasService {
  constructor(private readonly db: DbService) {}

  listar(s: Tenant): Promise<ObraResumen[]> {
    return this.db.tenant(s, async (c) => {
      const { rows } = await c.query<ObraResumen>(
        `SELECT o.id, o.clave, o.nombre, o.cliente, o.monto_contrato, o.presupuesto_estado,
                array_agg(DISTINCT r.rol::text) AS roles
           FROM obras o
           JOIN (SELECT obra_id, rol FROM obra_miembros WHERE usuario_id = $1
                 UNION ALL
                 SELECT o2.id, er.rol FROM empresa_roles er JOIN obras o2 ON o2.empresa_id = er.empresa_id
                  WHERE er.usuario_id = $1) r ON r.obra_id = o.id
          WHERE o.activa
          GROUP BY o.id ORDER BY o.clave`,
        [s.usuarioId],
      );
      return rows;
    });
  }

  presupuesto(s: Tenant, obraId: string): Promise<ConceptoPresupuesto[]> {
    return this.db.tenant(s, async (c) => {
      const roles = await exigirRol(c, s.usuarioId, obraId, ['CABO', 'ALMACEN', ...VEN_IMPORTES]);
      const conImportes = roles.some((r) => r === 'DIRECTOR' || r === 'ADMIN' || (VEN_IMPORTES as readonly string[]).includes(r));
      const conceptos = await cargarPresupuesto(c, obraId);
      return conImportes ? conceptos : conceptos.map(ocultarImportes);
    });
  }

  kpis(s: Tenant, obraId: string): Promise<KpiObra> {
    return this.db.tenant(s, async (c) => {
      await exigirRol(c, s.usuarioId, obraId, ['GERENTE_OBRA', 'RESIDENTE', 'FINANZAS']);
      const { rows } = await c.query<KpiObra>('SELECT * FROM v_kpi_obra WHERE obra_id = $1', [obraId]);
      if (!rows[0]) throw new NotFoundException('Obra sin presupuesto');
      return rows[0];
    });
  }
}

/** Árbol plano partida → concepto → líneas de control con sus saldos del libro mayor. */
export async function cargarPresupuesto(c: PoolClient, obraId: string): Promise<ConceptoPresupuesto[]> {
  const { rows } = await c.query<ConceptoPresupuesto>(
    `SELECT k.concepto_id, p.clave AS partida_clave, p.descripcion AS partida_descripcion,
            co.clave, co.descripcion, co.unidad, co.cantidad_vigente, co.importe_costo_vigente,
            k.pct_fisico, k.pct_financiero,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'linea_control_id', s.linea_control_id, 'insumo_clave', i.clave,
                       'insumo_descripcion', i.descripcion, 'insumo_tipo', i.tipo, 'unidad', i.unidad,
                       'cantidad_vigente', s.cantidad_vigente, 'precio_vigente', s.precio_vigente,
                       'importe_vigente', s.importe_vigente, 'imp_reservado', s.imp_reservado,
                       'imp_comprometido', s.imp_comprometido, 'imp_ejercido', s.imp_ejercido,
                       'imp_pagado', s.imp_pagado, 'cant_disponible', s.cant_disponible,
                       'imp_disponible', s.imp_disponible) ORDER BY i.clave)
                FROM v_saldo_linea_control s JOIN insumos i ON i.id = s.insumo_id
               WHERE s.concepto_id = co.id), '[]') AS lineas
       FROM conceptos co
       JOIN partidas p ON p.id = co.partida_id
       JOIN v_kpi_concepto k ON k.concepto_id = co.id
      WHERE co.obra_id = $1
      ORDER BY co.clave`,
    [obraId],
  );
  return rows;
}

export function ocultarImportes(co: ConceptoPresupuesto): ConceptoPresupuesto {
  return {
    ...co,
    importe_costo_vigente: 0,
    pct_financiero: 0,
    lineas: co.lineas.map((l) => ({
      ...l, precio_vigente: 0, importe_vigente: 0, imp_reservado: 0, imp_comprometido: 0,
      imp_ejercido: 0, imp_pagado: 0, imp_disponible: 0,
    })),
  };
}
