using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Domain.Calculo;

/// <summary>
/// Costo directo unitario de un insumo separado por tipo de cargo.
/// <para>
/// Herramienta menor y equipo de seguridad son un porcentaje de la mano de obra. Para no
/// cobrarlos dos veces cuando un básico ya los cargó (un mortero dentro de un muro), se
/// arrastra la mano de obra "pendiente" de cada cargo: sólo sube al padre la del hijo que
/// no aplicó ese cargo.
/// </para>
/// </summary>
public readonly record struct Desglose(
    decimal Materiales,
    decimal ManoObra,
    decimal Equipo,
    decimal Herramienta,
    decimal EquipoSeguridad,
    decimal ManoObraPendienteHerramienta,
    decimal ManoObraPendienteSeguridad,
    decimal HerramientaPropia,
    decimal EquipoSeguridadPropio)
{
    public decimal CostoDirecto => Materiales + ManoObra + Equipo + Herramienta + EquipoSeguridad;

    public static Desglose DeElemental(TipoInsumo tipo, decimal costo) => tipo switch
    {
        TipoInsumo.MAT => new Desglose { Materiales = costo },
        TipoInsumo.MO => new Desglose { ManoObra = costo, ManoObraPendienteHerramienta = costo, ManoObraPendienteSeguridad = costo },
        TipoInsumo.EQ => new Desglose { Equipo = costo },
        _ => throw new ReglaDeNegocioException($"{tipo} no es elemental"),
    };

    /// <summary>Aporte de <paramref name="cantidad"/> unidades de este insumo a su padre.</summary>
    public Desglose Escalar(decimal cantidad) => new(
        Materiales * cantidad, ManoObra * cantidad, Equipo * cantidad, Herramienta * cantidad, EquipoSeguridad * cantidad,
        ManoObraPendienteHerramienta * cantidad, ManoObraPendienteSeguridad * cantidad, 0m, 0m);

    public static Desglose operator +(Desglose a, Desglose b) => new(
        a.Materiales + b.Materiales, a.ManoObra + b.ManoObra, a.Equipo + b.Equipo,
        a.Herramienta + b.Herramienta, a.EquipoSeguridad + b.EquipoSeguridad,
        a.ManoObraPendienteHerramienta + b.ManoObraPendienteHerramienta,
        a.ManoObraPendienteSeguridad + b.ManoObraPendienteSeguridad, 0m, 0m);
}
