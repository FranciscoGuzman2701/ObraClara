using ObraClara.Apu.Domain.Catalogo;
using ObraClara.Apu.Domain.Presupuestos;

namespace ObraClara.Apu.Application;

/// <summary>Costo directo guardado en la base para un insumo, con su desglose.</summary>
public sealed record CostoGuardado(int InsumoId, decimal Material, decimal ManoObra, decimal Equipo,
    decimal Herramienta, decimal EquipoSeguridad, decimal CostoDirecto);

public sealed record PartidaCalculada(int PartidaId, int? PadreId, TipoPartida Tipo, string Clave, string Descripcion,
    string? ConceptoClave, string? Unidad, decimal? Cantidad, decimal? CostoDirectoUnitario, decimal? PrecioUnitario, decimal Importe);

/// <summary>Persistencia del catálogo y los presupuestos (implementación: SQL Server).</summary>
public interface IRepositorioApu
{
    Task<CatalogoInsumos> CargarCatalogoAsync(CancellationToken ct = default);
    Task<IReadOnlyList<CostoGuardado>> CargarCostosAsync(CancellationToken ct = default);
    Task<Presupuesto> CargarPresupuestoAsync(int presupuestoId, CatalogoInsumos catalogo, CancellationToken ct = default);

    /// <summary>Cambia el precio de un elemental y recalcula en cascada en el servidor. Devuelve cuántos insumos se recalcularon.</summary>
    Task<int> ActualizarPrecioAsync(int insumoId, decimal precio, CancellationToken ct = default);
    /// <summary>Alta o cambio de un renglón de matriz; el servidor valida tipos y ciclos y recalcula en cascada.</summary>
    Task GuardarComponenteAsync(int padreId, ComponenteApu componente, CancellationToken ct = default);
    Task QuitarComponenteAsync(int padreId, int hijoId, CancellationToken ct = default);
    Task RecalcularTodoAsync(CancellationToken ct = default);

    Task<IReadOnlyList<PartidaCalculada>> CalcularPresupuestoAsync(int presupuestoId, CancellationToken ct = default);
    Task<ResultadoExplosion> ExplosionAsync(int presupuestoId, CancellationToken ct = default);
}
