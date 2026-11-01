using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Domain.Calculo;

public sealed record CuotaCalculada(string Concepto, BaseCuota Base, decimal Tasa, decimal ImporteAnual);

/// <summary>Resultado del FSR con todos los términos intermedios para auditoría.</summary>
public sealed record ResultadoFsr(
    decimal SalarioNominal,
    decimal DiasPagados,          // Tp
    decimal DiasLaborados,        // Tl
    decimal FactorIntegracion,    // Tp / días calendario
    decimal SalarioBaseCotizacion,
    IReadOnlyList<CuotaCalculada> Cuotas,
    decimal CuotasAnuales,
    decimal Ps,
    decimal Fsr,
    decimal SalarioReal);

/// <summary>
/// Factor de Salario Real (Reglamento LOPSRM art. 191):
/// <code>
///   FSR = Ps·(Tp/Tl) + Tp/Tl
///   Tp  = días calendario + aguinaldo + vacaciones × prima vacacional   (días pagados)
///   Tl  = días calendario − días no laborados (domingos, festivos, vacaciones, clima, costumbre…)
///   Ps  = cuotas patronales anuales / (salario nominal × Tp)
///   SBC = min(salario nominal × Tp / días calendario, tope × UMA)
/// </code>
/// Equivale a: salario real = (lo pagado en el año + cuotas) / días efectivamente laborados.
/// </summary>
public static class CalculadoraFsr
{
    public static ResultadoFsr Calcular(decimal salarioNominal, ParametrosFsr p)
    {
        if (salarioNominal <= 0) throw new ReglaDeNegocioException("El salario nominal debe ser mayor a cero");
        p.Validar();

        var tp = p.DiasCalendario + p.DiasAguinaldo + p.DiasVacaciones * p.TasaPrimaVacacional;
        var tl = p.DiasCalendario - p.DiasNoLaborados.Sum(d => d.Dias);
        var factorIntegracion = tp / p.DiasCalendario;
        var sbc = Math.Min(salarioNominal * factorIntegracion, p.TopeSbcEnUmas * p.Uma);

        var cuotas = p.Cuotas.Select(c => new CuotaCalculada(c.Concepto, c.Base, c.Tasa, c.Tasa * c.Base switch
        {
            BaseCuota.SalarioBaseCotizacion => sbc * p.DiasCalendario,
            BaseCuota.Uma => p.Uma * p.DiasCalendario,
            BaseCuota.ExcedenteTresUma => Math.Max(0m, sbc - 3m * p.Uma) * p.DiasCalendario,
            BaseCuota.SalarioPagado => salarioNominal * tp,
            _ => throw new ReglaDeNegocioException($"Base de cuota desconocida: {c.Base}"),
        })).ToList();

        var cuotasAnuales = cuotas.Sum(c => c.ImporteAnual);
        var ps = cuotasAnuales / (salarioNominal * tp);
        var fsr = ps * (tp / tl) + tp / tl;
        return new ResultadoFsr(salarioNominal, tp, tl, factorIntegracion, sbc, cuotas, cuotasAnuales, ps, fsr, salarioNominal * fsr);
    }
}
