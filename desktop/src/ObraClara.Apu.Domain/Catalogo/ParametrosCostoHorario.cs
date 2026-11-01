namespace ObraClara.Apu.Domain.Catalogo;

/// <summary>
/// Datos de una máquina para su costo horario (metodología del Reglamento de la Ley de
/// Obras Públicas y Servicios Relacionados con las Mismas, arts. 194–209).
/// Tasas como fracción decimal; horas = horas efectivas de trabajo.
/// </summary>
public sealed record ParametrosCostoHorario
{
    /// <summary>Va: precio de adquisición de la máquina nueva puesta en obra.</summary>
    public required decimal PrecioAdquisicion { get; init; }
    /// <summary>Pn: valor de las llantas (se excluye de la depreciación).</summary>
    public decimal ValorLlantas { get; init; }
    /// <summary>Pa: valor de piezas de desgaste especial (se excluye de la depreciación).</summary>
    public decimal ValorPiezasEspeciales { get; init; }
    /// <summary>r: valor de rescate como fracción de Vm.</summary>
    public required decimal TasaValorRescate { get; init; }
    /// <summary>Ve: vida económica en horas efectivas.</summary>
    public required decimal VidaEconomicaHoras { get; init; }
    /// <summary>Hea: horas efectivas trabajadas por año.</summary>
    public required decimal HorasEfectivasAnio { get; init; }
    /// <summary>i: tasa de interés anual.</summary>
    public required decimal TasaInteresAnual { get; init; }
    /// <summary>s: prima anual promedio de seguros.</summary>
    public required decimal TasaSeguroAnual { get; init; }
    /// <summary>Ko: coeficiente de mantenimiento mayor y menor (Mn = Ko·D).</summary>
    public required decimal CoeficienteMantenimiento { get; init; }

    /// <summary>Potencia nominal (HP) para estimar el consumo de combustible.</summary>
    public decimal PotenciaHp { get; init; }
    /// <summary>Fo: factor de operación (fracción de la potencia usada en promedio).</summary>
    public decimal FactorOperacion { get; init; }
    /// <summary>Litros por HP-hora (típico: diésel 0.1514, gasolina 0.2271).</summary>
    public decimal CoeficienteCombustible { get; init; }
    public int? CombustibleInsumoId { get; init; }

    /// <summary>C: capacidad del cárter en litros.</summary>
    public decimal CapacidadCarterLitros { get; init; }
    /// <summary>t: horas efectivas entre cambios de aceite.</summary>
    public decimal HorasEntreCambios { get; init; }
    /// <summary>Ah: consumo (reposición) de aceite por hora entre cambios, litros/hora.</summary>
    public decimal ConsumoAceiteHora { get; init; }
    public int? LubricanteInsumoId { get; init; }

    /// <summary>Vn: vida económica de las llantas en horas.</summary>
    public decimal VidaLlantasHoras { get; init; }
    /// <summary>Va de piezas: vida económica de piezas especiales en horas.</summary>
    public decimal VidaPiezasHoras { get; init; }

    /// <summary>Insumo de mano de obra del operador (su costo es el salario real por jornada).</summary>
    public int? OperadorInsumoId { get; init; }
    /// <summary>Ht: horas efectivas por turno.</summary>
    public decimal HorasEfectivasTurno { get; init; } = 8m;

    public IEnumerable<int> Dependencias()
    {
        if (CombustibleInsumoId is { } c) yield return c;
        if (LubricanteInsumoId is { } l) yield return l;
        if (OperadorInsumoId is { } o) yield return o;
    }

    public void Validar()
    {
        if (PrecioAdquisicion <= 0) throw new ReglaDeNegocioException("El precio de adquisición debe ser mayor a cero");
        if (ValorLlantas < 0 || ValorPiezasEspeciales < 0 || ValorLlantas + ValorPiezasEspeciales >= PrecioAdquisicion)
            throw new ReglaDeNegocioException("Llantas y piezas especiales deben ser menores al precio de adquisición");
        if (TasaValorRescate is < 0 or >= 1) throw new ReglaDeNegocioException("El valor de rescate debe estar entre 0 y 1");
        if (VidaEconomicaHoras <= 0 || HorasEfectivasAnio <= 0) throw new ReglaDeNegocioException("Vida económica y horas por año deben ser positivas");
        if (ValorLlantas > 0 && VidaLlantasHoras <= 0) throw new ReglaDeNegocioException("Falta la vida de las llantas");
        if (ValorPiezasEspeciales > 0 && VidaPiezasHoras <= 0) throw new ReglaDeNegocioException("Falta la vida de las piezas especiales");
        if (CapacidadCarterLitros > 0 && HorasEntreCambios <= 0) throw new ReglaDeNegocioException("Faltan las horas entre cambios de aceite");
        if (OperadorInsumoId is not null && HorasEfectivasTurno <= 0) throw new ReglaDeNegocioException("Faltan las horas efectivas por turno");
    }
}
