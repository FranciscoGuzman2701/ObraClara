using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;
using ObraClara.Apu.Domain.Presupuestos;

namespace ObraClara.Apu.Domain.Analisis;

/// <summary>Avance acumulado de un concepto del presupuesto (lo captura obra; el costo real, compras/finanzas).</summary>
public sealed record AvanceConcepto(int PartidaId, decimal CantidadEjecutada, decimal CostoReal);

/// <summary>Consumo real acumulado de un material en la obra (salidas de almacén).</summary>
public sealed record ConsumoMaterial(int InsumoId, decimal CantidadReal);

public sealed record DatosControl(IReadOnlyList<AvanceConcepto> Avances, IReadOnlyList<ConsumoMaterial> Consumos)
{
    public static DatosControl Vacio { get; } = new([], []);
}

/// <summary>
/// Resultado por concepto. "Costo" es costo directo; "venta" es volumen × P.U. del presupuesto.
/// Margen = venta − costo directo (antes de indirectos de oficina, que no dependen del concepto).
/// </summary>
public sealed record AnalisisConcepto(
    int PartidaId, string Clave, string Descripcion, string Unidad,
    decimal CantidadPresupuestada, decimal CantidadEjecutada, decimal PrecioUnitario, decimal CostoDirectoUnitario,
    decimal Venta, decimal CostoPresupuestado, decimal ValorGanado, decimal CostoReal, decimal CostoProyectado)
{
    /// <summary>Avance físico (puede pasar de 100 % si se ejecutó más de lo presupuestado).</summary>
    public decimal PctAvance => CantidadPresupuestada == 0 ? 0 : CantidadEjecutada / CantidadPresupuestada;
    /// <summary>CPI = valor ganado / costo real. &lt; 1: cada unidad cuesta más de lo presupuestado.</summary>
    public decimal? Cpi => CostoReal == 0 ? null : ValorGanado / CostoReal;
    public decimal MargenPresupuestado => Venta - CostoPresupuestado;
    public decimal MargenProyectado => Venta - CostoProyectado;
    /// <summary>Positivo: la obra gana más de lo previsto en este concepto; negativo: pierde.</summary>
    public decimal Variacion => MargenProyectado - MargenPresupuestado;
    /// <summary>Volumen ejecutado fuera del alcance del presupuesto (requiere extraordinario o se regala).</summary>
    public decimal CantidadFueraDeAlcance => Math.Max(0, CantidadEjecutada - CantidadPresupuestada);
    public decimal ImporteFueraDeAlcance => CantidadFueraDeAlcance * PrecioUnitario;
}

/// <summary>Desperdicio de un material: consumo real contra lo que el avance justifica.</summary>
public sealed record AnalisisDesperdicio(
    int InsumoId, string Clave, string Descripcion, string Unidad, decimal CostoUnitario,
    decimal TeoricoSinMerma, decimal PermitidoConMerma, decimal Real)
{
    /// <summary>Merma que el presupuesto ya contemplaba.</summary>
    public decimal MermaPermitida => PermitidoConMerma - TeoricoSinMerma;
    /// <summary>Consumo por encima de lo permitido: desperdicio no presupuestado (o faltante si es negativo).</summary>
    public decimal Excedente => Real - PermitidoConMerma;
    public decimal ImporteExcedente => Excedente * CostoUnitario;
    /// <summary>Desperdicio real total sobre el teórico (incluye la merma permitida).</summary>
    public decimal? PctDesperdicioReal => TeoricoSinMerma == 0 ? null : (Real - TeoricoSinMerma) / TeoricoSinMerma;
    public decimal? PctMermaPermitida => TeoricoSinMerma == 0 ? null : MermaPermitida / TeoricoSinMerma;
}

public sealed record ResultadoAnalisis(IReadOnlyList<AnalisisConcepto> Conceptos, IReadOnlyList<AnalisisDesperdicio> Desperdicio)
{
    public decimal Venta => Conceptos.Sum(c => c.Venta);
    public decimal CostoPresupuestado => Conceptos.Sum(c => c.CostoPresupuestado);
    public decimal ValorGanado => Conceptos.Sum(c => c.ValorGanado);
    public decimal CostoReal => Conceptos.Sum(c => c.CostoReal);
    public decimal CostoProyectado => Conceptos.Sum(c => c.CostoProyectado);
    public decimal MargenPresupuestado => Venta - CostoPresupuestado;
    public decimal MargenProyectado => Venta - CostoProyectado;
    public decimal Variacion => MargenProyectado - MargenPresupuestado;
    /// <summary>Avance físico ponderado por costo: valor ganado / costo presupuestado.</summary>
    public decimal PctAvance => CostoPresupuestado == 0 ? 0 : Math.Min(ValorGanado, CostoPresupuestado) / CostoPresupuestado;
    public decimal? Cpi => CostoReal == 0 ? null : ValorGanado / CostoReal;
    public decimal ImporteFueraDeAlcance => Conceptos.Sum(c => c.ImporteFueraDeAlcance);
    public decimal ImporteDesperdicio => Desperdicio.Where(d => d.Excedente > 0).Sum(d => d.ImporteExcedente);
}

/// <summary>
/// Análisis de obra en marcha: dónde gana y pierde, alcance y desperdicio.
/// <code>
///   valor ganado  EV  = min(ejecutado, presupuestado) × CD unitario
///   CPI               = EV / costo real
///   costo proyectado  = costo real + (presupuestado − ejecutado)⁺ × CD unitario / CPI
///                      (si el rendimiento sigue como va; sin costo real aún: el presupuestado)
///   desperdicio       = consumo real − ejecutado × receta con merma (receta = explosión por unidad)
/// </code>
/// </summary>
public static class AnalizadorObra
{
    public static ResultadoAnalisis Analizar(Presupuesto presupuesto, CatalogoInsumos catalogo, ResultadoCostos costos, DatosControl control)
    {
        var importes = CalculadoraPresupuesto.Calcular(presupuesto, costos).Partidas;
        var avances = control.Avances.GroupBy(a => a.PartidaId)
            .ToDictionary(g => g.Key, g => (Cantidad: g.Sum(a => a.CantidadEjecutada), Costo: g.Sum(a => a.CostoReal)));

        var conceptos = new List<AnalisisConcepto>();
        var permitido = new Dictionary<int, decimal>();
        var teorico = new Dictionary<int, decimal>();
        var conMerma = new Dictionary<int, Dictionary<int, decimal>>();
        var sinMerma = new Dictionary<int, Dictionary<int, decimal>>();

        foreach (var p in presupuesto.Conceptos.OrderBy(p => p.Clave, StringComparer.Ordinal))
        {
            var insumo = catalogo[p.InsumoId!.Value];
            var imp = importes[p.Id];
            var (ejecutado, costoReal) = avances.GetValueOrDefault(p.Id);
            var cdUnitario = imp.CostoDirectoUnitario;
            var valorGanado = Math.Min(ejecutado, p.Cantidad) * cdUnitario;
            var restante = Math.Max(0, p.Cantidad - ejecutado) * cdUnitario;
            var cpi = costoReal > 0 && valorGanado > 0 ? valorGanado / costoReal : 1m;
            var proyectado = costoReal + restante / cpi;

            conceptos.Add(new AnalisisConcepto(p.Id, p.Clave, insumo.Descripcion, insumo.Unidad,
                p.Cantidad, ejecutado, imp.PrecioUnitario, cdUnitario,
                imp.Importe, p.Cantidad * cdUnitario, valorGanado, costoReal, proyectado));

            if (ejecutado <= 0) continue;
            foreach (var (id, cant) in Receta(insumo.Id, catalogo, conMerma, true))
                if (catalogo[id].Tipo == TipoInsumo.MAT) permitido[id] = permitido.GetValueOrDefault(id) + cant * ejecutado;
            foreach (var (id, cant) in Receta(insumo.Id, catalogo, sinMerma, false))
                if (catalogo[id].Tipo == TipoInsumo.MAT) teorico[id] = teorico.GetValueOrDefault(id) + cant * ejecutado;
        }

        var reales = control.Consumos.GroupBy(c => c.InsumoId).ToDictionary(g => g.Key, g => g.Sum(c => c.CantidadReal));
        var desperdicio = permitido.Keys.Union(reales.Keys)
            .Select(id => catalogo[id])
            .Select(i => new AnalisisDesperdicio(i.Id, i.Clave, i.Descripcion, i.Unidad, costos.CostoDirecto(i.Id),
                teorico.GetValueOrDefault(i.Id), permitido.GetValueOrDefault(i.Id), reales.GetValueOrDefault(i.Id)))
            .OrderByDescending(d => d.ImporteExcedente)
            .ToList();
        return new ResultadoAnalisis(conceptos, desperdicio);
    }

    /// <summary>Cantidad de cada elemental por unidad del compuesto, con o sin merma (memoizada).</summary>
    private static Dictionary<int, decimal> Receta(int id, CatalogoInsumos catalogo, Dictionary<int, Dictionary<int, decimal>> memo, bool conMerma)
    {
        if (memo.TryGetValue(id, out var r)) return r;
        r = [];
        foreach (var c in catalogo[id].Componentes)
        {
            var cant = conMerma ? c.CantidadEfectiva : c.CantidadEfectiva / (1m + c.TasaMerma);
            if (catalogo[c.HijoId].Tipo.EsElemental()) r[c.HijoId] = r.GetValueOrDefault(c.HijoId) + cant;
            else
                foreach (var (hijo, q) in Receta(c.HijoId, catalogo, memo, conMerma))
                    r[hijo] = r.GetValueOrDefault(hijo) + q * cant;
        }
        return memo[id] = r;
    }
}
