namespace ObraClara.Apu.Domain.Catalogo;

/// <summary>Base sobre la que se aplica una cuota obrero-patronal o impuesto sobre nómina.</summary>
public enum BaseCuota : byte
{
    /// <summary>Salario base de cotización diario × días calendario (riesgo de trabajo, retiro, INFONAVIT…).</summary>
    SalarioBaseCotizacion = 1,
    /// <summary>UMA diaria × días calendario (cuota fija de enfermedad y maternidad).</summary>
    Uma = 2,
    /// <summary>Excedente del SBC sobre 3 UMA × días calendario.</summary>
    ExcedenteTresUma = 3,
    /// <summary>Salario efectivamente pagado en el año (impuesto estatal sobre nómina).</summary>
    SalarioPagado = 4,
}

public sealed record CuotaPatronal(string Concepto, BaseCuota Base, decimal Tasa);

public sealed record DiasNoLaborados(string Concepto, decimal Dias);

/// <summary>
/// Parámetros anuales para integrar el Factor de Salario Real. Normalmente uno por
/// empresa y ejercicio; cada insumo de mano de obra aporta sólo su salario nominal.
/// Todas las tasas son fracciones decimales (0.05 = 5 %).
/// </summary>
public sealed record ParametrosFsr
{
    public required int Id { get; init; }
    public required string Nombre { get; init; }
    public decimal DiasCalendario { get; init; } = 365m;
    public decimal DiasAguinaldo { get; init; } = 15m;
    public decimal DiasVacaciones { get; init; } = 12m;
    public decimal TasaPrimaVacacional { get; init; } = 0.25m;
    /// <summary>Valor diario de la UMA vigente.</summary>
    public required decimal Uma { get; init; }
    /// <summary>Tope del SBC en número de UMA (Ley del Seguro Social: 25).</summary>
    public decimal TopeSbcEnUmas { get; init; } = 25m;
    public IReadOnlyList<DiasNoLaborados> DiasNoLaborados { get; init; } = [];
    public IReadOnlyList<CuotaPatronal> Cuotas { get; init; } = [];

    public void Validar()
    {
        if (DiasCalendario is not (365m or 366m)) throw new ReglaDeNegocioException("Los días calendario deben ser 365 o 366");
        if (Uma <= 0) throw new ReglaDeNegocioException("La UMA debe ser mayor a cero");
        if (DiasAguinaldo < 0 || DiasVacaciones < 0 || TasaPrimaVacacional < 0)
            throw new ReglaDeNegocioException("Las prestaciones no pueden ser negativas");
        if (DiasNoLaborados.Any(d => d.Dias < 0)) throw new ReglaDeNegocioException("Los días no laborados no pueden ser negativos");
        if (DiasNoLaborados.Sum(d => d.Dias) >= DiasCalendario)
            throw new ReglaDeNegocioException("Los días no laborados deben ser menores a los días calendario");
        if (Cuotas.Any(c => c.Tasa is < 0 or > 1)) throw new ReglaDeNegocioException("Cada cuota debe estar entre 0 y 1");
    }
}
