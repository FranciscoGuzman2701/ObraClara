using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Domain.Presupuestos;

public sealed record ImportePartida(int PartidaId, decimal CostoDirectoUnitario, decimal PrecioUnitario, decimal Importe);

public sealed record ResultadoPresupuesto(IReadOnlyDictionary<int, ImportePartida> Partidas, decimal Total);

public sealed record InsumoExplosionado(int InsumoId, string Clave, string Descripcion, string Unidad, TipoInsumo Tipo,
    decimal Cantidad, decimal CostoUnitario, decimal Importe);

public sealed record ResultadoExplosion(IReadOnlyList<InsumoExplosionado> Insumos, decimal Herramienta, decimal EquipoSeguridad)
{
    /// <summary>Costo directo total de la obra; debe igualar Σ volumen × CD de los conceptos.</summary>
    public decimal CostoDirectoTotal => Insumos.Sum(i => i.Importe) + Herramienta + EquipoSeguridad;
}

public static class CalculadoraPresupuesto
{
    /// <summary>
    /// Importe de concepto = volumen × PU de venta (PU redondeado según el sobrecosto);
    /// capítulos y subcapítulos suman a sus hijas.
    /// </summary>
    public static ResultadoPresupuesto Calcular(Presupuesto presupuesto, ResultadoCostos costos)
    {
        var importes = new Dictionary<int, ImportePartida>();
        decimal Sumar(PartidaPresupuesto p)
        {
            if (p.Tipo == TipoPartida.Concepto)
            {
                var cd = costos.CostoDirecto(p.InsumoId!.Value);
                var pu = CalculadoraPrecioVenta.Calcular(cd, presupuesto.Sobrecosto).PrecioUnitario;
                var importe = Math.Round(p.Cantidad * pu, 2, MidpointRounding.AwayFromZero);
                importes[p.Id] = new ImportePartida(p.Id, cd, pu, importe);
                return importe;
            }
            var total = presupuesto.Hijas(p.Id).Sum(Sumar);
            importes[p.Id] = new ImportePartida(p.Id, 0, 0, total);
            return total;
        }
        var granTotal = presupuesto.Hijas(null).Sum(Sumar);
        return new ResultadoPresupuesto(importes, granTotal);
    }

    /// <summary>
    /// Explosión de insumos: cantidades totales de materiales, jornadas y horas-máquina
    /// para toda la obra. Cada compuesto se reduce una sola vez a su "receta" elemental
    /// por unidad (memoizada) y después se multiplica por los volúmenes.
    /// </summary>
    public static ResultadoExplosion Explosionar(Presupuesto presupuesto, CatalogoInsumos catalogo, ResultadoCostos costos)
    {
        var recetas = new Dictionary<int, Receta>();
        var total = new Receta();
        foreach (var p in presupuesto.Conceptos)
            total.Sumar(RecetaDe(p.InsumoId!.Value, catalogo, costos, recetas), p.Cantidad);

        var insumos = total.Cantidades
            .Select(kv => (Insumo: catalogo[kv.Key], Cantidad: kv.Value))
            .Select(x => new InsumoExplosionado(x.Insumo.Id, x.Insumo.Clave, x.Insumo.Descripcion, x.Insumo.Unidad, x.Insumo.Tipo,
                x.Cantidad, costos.CostoDirecto(x.Insumo.Id), x.Cantidad * costos.CostoDirecto(x.Insumo.Id)))
            .OrderBy(i => i.Tipo).ThenBy(i => i.Clave, StringComparer.Ordinal)
            .ToList();
        return new ResultadoExplosion(insumos, total.Herramienta, total.EquipoSeguridad);
    }

    private sealed class Receta
    {
        public Dictionary<int, decimal> Cantidades { get; } = [];
        public decimal Herramienta { get; private set; }
        public decimal EquipoSeguridad { get; private set; }

        public void Sumar(Receta otra, decimal factor)
        {
            foreach (var (id, cant) in otra.Cantidades) Cantidades[id] = Cantidades.GetValueOrDefault(id) + cant * factor;
            Herramienta += otra.Herramienta * factor;
            EquipoSeguridad += otra.EquipoSeguridad * factor;
        }

        public void SumarElemental(int id, decimal cant) => Cantidades[id] = Cantidades.GetValueOrDefault(id) + cant;
        public void SumarCargosPropios(Desglose d) => (Herramienta, EquipoSeguridad) = (Herramienta + d.HerramientaPropia, EquipoSeguridad + d.EquipoSeguridadPropio);
    }

    private static Receta RecetaDe(int compuestoId, CatalogoInsumos catalogo, ResultadoCostos costos, Dictionary<int, Receta> memo)
    {
        if (memo.TryGetValue(compuestoId, out var r)) return r;
        r = new Receta();
        var compuesto = catalogo[compuestoId];
        foreach (var c in compuesto.Componentes)
        {
            if (catalogo[c.HijoId].Tipo.EsElemental()) r.SumarElemental(c.HijoId, c.CantidadEfectiva);
            else r.Sumar(RecetaDe(c.HijoId, catalogo, costos, memo), c.CantidadEfectiva);
        }
        r.SumarCargosPropios(costos.Desglose(compuestoId));
        return memo[compuestoId] = r;
    }
}
