namespace ObraClara.Apu.Domain.Calculo;

public sealed record CargoAdicional(string Concepto, decimal Tasa);

/// <summary>
/// Pie de precio unitario. Tasas como fracción decimal.
/// La utilidad es la tasa BRUTA que se aplica al precio (use <see cref="CalculadoraUtilidad"/>
/// para obtenerla a partir de la utilidad neta deseada).
/// </summary>
public sealed record ParametrosSobrecosto
{
    public required int Id { get; init; }
    public required string Nombre { get; init; }
    public decimal TasaIndirectoOficinaCentral { get; init; }
    public decimal TasaIndirectoCampo { get; init; }
    public decimal TasaFinanciamiento { get; init; }
    public decimal TasaUtilidad { get; init; }
    public IReadOnlyList<CargoAdicional> CargosAdicionales { get; init; } = [];
    /// <summary>Decimales del precio unitario de venta (2 = centavos).</summary>
    public int DecimalesPrecioUnitario { get; init; } = 2;

    public decimal TasaIndirectos => TasaIndirectoOficinaCentral + TasaIndirectoCampo;
    public decimal TasaCargosAdicionales => CargosAdicionales.Sum(c => c.Tasa);

    public void Validar()
    {
        decimal[] tasas = [TasaIndirectoOficinaCentral, TasaIndirectoCampo, TasaFinanciamiento, TasaUtilidad];
        if (tasas.Any(t => t is < 0 or > 1)) throw new ReglaDeNegocioException("Las tasas de sobrecosto deben estar entre 0 y 1");
        if (CargosAdicionales.Any(c => c.Tasa < 0) || TasaCargosAdicionales >= 1)
            throw new ReglaDeNegocioException("Los cargos adicionales deben sumar menos de 1");
        if (DecimalesPrecioUnitario is < 0 or > 6) throw new ReglaDeNegocioException("Decimales de precio fuera de rango");
    }
}

public sealed record PieDePrecio(
    decimal CostoDirecto,
    decimal IndirectoOficinaCentral,
    decimal IndirectoCampo,
    decimal Financiamiento,
    decimal Utilidad,
    IReadOnlyList<(string Concepto, decimal Importe)> CargosAdicionales,
    decimal PrecioUnitarioSinRedondear,
    decimal PrecioUnitario)
{
    public decimal Indirectos => IndirectoOficinaCentral + IndirectoCampo;
    /// <summary>Factor de sobrecosto: PU / CD.</summary>
    public decimal Factor => CostoDirecto == 0 ? 0 : PrecioUnitarioSinRedondear / CostoDirecto;
}

/// <summary>
/// Cascada de sobrecostos:
/// <code>
///   I   = CD · (ioc + ic)
///   F   = (CD + I) · f
///   U   = (CD + I + F) · u
///   PU  = (CD + I + F + U) / (1 − Σ ca)      // los cargos adicionales son fracción del PU final
///   CAk = PU · cak
/// </code>
/// </summary>
public static class CalculadoraPrecioVenta
{
    public static PieDePrecio Calcular(decimal costoDirecto, ParametrosSobrecosto p)
    {
        p.Validar();
        var ioc = costoDirecto * p.TasaIndirectoOficinaCentral;
        var ic = costoDirecto * p.TasaIndirectoCampo;
        var f = (costoDirecto + ioc + ic) * p.TasaFinanciamiento;
        var u = (costoDirecto + ioc + ic + f) * p.TasaUtilidad;
        var pu = (costoDirecto + ioc + ic + f + u) / (1m - p.TasaCargosAdicionales);
        var cargos = p.CargosAdicionales.Select(c => (c.Concepto, pu * c.Tasa)).ToList();
        var redondeado = Math.Round(pu, p.DecimalesPrecioUnitario, MidpointRounding.AwayFromZero);
        return new PieDePrecio(costoDirecto, ioc, ic, f, u, cargos, pu, redondeado);
    }
}

/// <summary>Porcentaje de indirectos = costos indirectos de la obra / costo directo total.</summary>
public static class CalculadoraIndirectos
{
    public sealed record Rubro(string Concepto, decimal Importe, bool EsOficinaCentral);

    public static (decimal TasaOficinaCentral, decimal TasaCampo) Calcular(IEnumerable<Rubro> rubros, decimal costoDirectoTotal)
    {
        if (costoDirectoTotal <= 0) throw new ReglaDeNegocioException("El costo directo total debe ser mayor a cero");
        var lista = rubros.ToList();
        return (lista.Where(r => r.EsOficinaCentral).Sum(r => r.Importe) / costoDirectoTotal,
                lista.Where(r => !r.EsOficinaCentral).Sum(r => r.Importe) / costoDirectoTotal);
    }
}

/// <summary>
/// Utilidad bruta a partir de la neta deseada, después de ISR y PTU:
/// u_bruta = u_neta / (1 − ISR − PTU).
/// </summary>
public static class CalculadoraUtilidad
{
    public static decimal TasaBruta(decimal tasaNeta, decimal tasaIsr, decimal tasaPtu)
    {
        if (tasaIsr + tasaPtu >= 1) throw new ReglaDeNegocioException("ISR + PTU deben ser menores a 1");
        return tasaNeta / (1m - tasaIsr - tasaPtu);
    }
}

/// <summary>
/// Costo por financiamiento a partir del flujo de caja de la obra.
/// <code>
///   saldo_k  = Σ_{j≤k} (ingresos_j − egresos_j)           // anticipo y estimaciones cobradas vs. gasto
///   interés_k = max(0, −saldo_k) · tasa del periodo         // sólo cuando la constructora pone dinero
///   tasa de financiamiento = Σ interés_k / Σ egresos        // se aplica sobre CD + indirectos
/// </code>
/// </summary>
public static class CalculadoraFinanciamiento
{
    public sealed record Periodo(decimal Egresos, decimal Ingresos);

    public sealed record Resultado(IReadOnlyList<(decimal Saldo, decimal Interes)> Periodos, decimal Intereses, decimal Tasa);

    public static Resultado Calcular(IReadOnlyList<Periodo> flujo, decimal tasaPorPeriodo)
    {
        if (flujo.Count == 0) throw new ReglaDeNegocioException("El flujo no tiene periodos");
        var egresos = flujo.Sum(p => p.Egresos);
        if (egresos <= 0) throw new ReglaDeNegocioException("El flujo no tiene egresos");
        var saldo = 0m;
        var detalle = new List<(decimal, decimal)>();
        foreach (var p in flujo)
        {
            saldo += p.Ingresos - p.Egresos;
            detalle.Add((saldo, Math.Max(0m, -saldo) * tasaPorPeriodo));
        }
        var intereses = detalle.Sum(d => d.Item2);
        return new Resultado(detalle, intereses, intereses / egresos);
    }
}
