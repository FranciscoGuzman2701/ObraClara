using ObraClara.Apu.Domain.Analisis;
using ObraClara.Apu.Domain.Catalogo;
using ObraClara.Apu.Domain.Presupuestos;

namespace ObraClara.Apu.Application.Reportes;

/// <summary>Archivos CSV para análisis de datos (Excel, Power BI, Python…).</summary>
public static class ExportadorCsv
{
    public static string Presupuesto(Presupuesto p, CatalogoInsumos catalogo, ResultadoPresupuesto r)
    {
        var filas = new List<object?[]>();
        void Agregar(int? padre, int nivel)
        {
            foreach (var h in p.Hijas(padre))
            {
                var imp = r.Partidas[h.Id];
                var ins = h.InsumoId is { } id ? catalogo[id] : null;
                filas.Add([p.Clave, h.Clave, nivel, h.Tipo.ToString(), ins?.Clave, ins?.Descripcion ?? h.Descripcion, ins?.Unidad,
                    ins is null ? null : h.Cantidad, ins is null ? null : imp.CostoDirectoUnitario,
                    ins is null ? null : imp.PrecioUnitario, imp.Importe]);
                Agregar(h.Id, nivel + 1);
            }
        }
        Agregar(null, 0);
        return Csv.Escribir(["obra", "partida", "nivel", "tipo", "concepto", "descripcion", "unidad", "cantidad",
            "costo_directo_unitario", "precio_unitario", "importe"], filas);
    }

    public static string Explosion(ResultadoExplosion e) =>
        Csv.Escribir(["tipo", "clave", "descripcion", "unidad", "cantidad", "costo_unitario", "importe"],
            e.Insumos.Select(i => new object?[] { i.Tipo.ToString(), i.Clave, i.Descripcion, i.Unidad, i.Cantidad, i.CostoUnitario, i.Importe })
                .Append(["CARGO", "HERRAMIENTA", "Herramienta menor", "$", null, null, e.Herramienta])
                .Append(["CARGO", "SEGURIDAD", "Equipo de seguridad", "$", null, null, e.EquipoSeguridad]));

    public static string AnalisisConceptos(ResultadoAnalisis a) =>
        Csv.Escribir(["partida", "descripcion", "unidad", "cantidad_presupuestada", "cantidad_ejecutada", "avance", "precio_unitario",
                "costo_directo_unitario", "venta", "costo_presupuestado", "valor_ganado", "costo_real", "cpi", "costo_proyectado",
                "margen_presupuestado", "margen_proyectado", "variacion", "cantidad_fuera_de_alcance", "importe_fuera_de_alcance"],
            a.Conceptos.Select(c => new object?[] { c.Clave, c.Descripcion, c.Unidad, c.CantidadPresupuestada, c.CantidadEjecutada,
                Math.Round(c.PctAvance, 6), c.PrecioUnitario, Math.Round(c.CostoDirectoUnitario, 6), c.Venta,
                Math.Round(c.CostoPresupuestado, 2), Math.Round(c.ValorGanado, 2), c.CostoReal,
                c.Cpi is { } cpi ? Math.Round(cpi, 4) : null, Math.Round(c.CostoProyectado, 2), Math.Round(c.MargenPresupuestado, 2),
                Math.Round(c.MargenProyectado, 2), Math.Round(c.Variacion, 2), c.CantidadFueraDeAlcance, Math.Round(c.ImporteFueraDeAlcance, 2) }));

    public static string Desperdicio(ResultadoAnalisis a) =>
        Csv.Escribir(["clave", "descripcion", "unidad", "costo_unitario", "teorico_sin_merma", "permitido_con_merma", "consumo_real",
                "merma_permitida", "excedente", "importe_excedente", "pct_desperdicio_real", "pct_merma_permitida"],
            a.Desperdicio.Select(d => new object?[] { d.Clave, d.Descripcion, d.Unidad, d.CostoUnitario, Math.Round(d.TeoricoSinMerma, 6),
                Math.Round(d.PermitidoConMerma, 6), d.Real, Math.Round(d.MermaPermitida, 6), Math.Round(d.Excedente, 6),
                Math.Round(d.ImporteExcedente, 2), d.PctDesperdicioReal is { } x ? Math.Round(x, 6) : null,
                d.PctMermaPermitida is { } y ? Math.Round(y, 6) : null }));
}
