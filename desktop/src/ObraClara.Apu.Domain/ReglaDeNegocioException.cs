namespace ObraClara.Apu.Domain;

/// <summary>Violación de una regla del dominio (datos inconsistentes, referencia circular, etc.).</summary>
public class ReglaDeNegocioException(string mensaje) : Exception(mensaje);

/// <summary>Un insumo compuesto se contiene a sí mismo, directa o indirectamente.</summary>
public sealed class ReferenciaCircularException(IReadOnlyList<string> ruta)
    : ReglaDeNegocioException($"Referencia circular: {string.Join(" → ", ruta)}")
{
    /// <summary>Claves de insumo que forman el ciclo; la primera y la última coinciden.</summary>
    public IReadOnlyList<string> Ruta { get; } = ruta;
}
