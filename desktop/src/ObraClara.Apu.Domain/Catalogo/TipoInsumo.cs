namespace ObraClara.Apu.Domain.Catalogo;

/// <summary>Tipificación normativa de insumos. Los valores coinciden con apu.TiposInsumo.</summary>
public enum TipoInsumo : byte
{
    /// <summary>Material puesto en obra.</summary>
    MAT = 1,
    /// <summary>Mano de obra (jornal); su costo es el salario real = salario nominal × FSR.</summary>
    MO = 2,
    /// <summary>Maquinaria y equipo; su costo es el costo horario.</summary>
    EQ = 3,
    /// <summary>Básico / auxiliar (morteros, concretos, cuadrillas). Compuesto reutilizable.</summary>
    BAS = 4,
    /// <summary>Concepto de obra. Compuesto que se presupuesta; no puede ser componente de otro.</summary>
    CON = 5,
}

public static class TipoInsumoExtensiones
{
    public static bool EsCompuesto(this TipoInsumo t) => t is TipoInsumo.BAS or TipoInsumo.CON;
    public static bool EsElemental(this TipoInsumo t) => !t.EsCompuesto();
}
