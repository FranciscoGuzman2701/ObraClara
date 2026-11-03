namespace ObraClara.Apu.Domain.Contabilidad;

/// <summary>
/// Jerarquías por clave, como en los catálogos contables:
/// <list type="bullet">
///   <item><b>Cuentas</b> con segmentos rellenos de ceros:
///         501-01-001 → 501-01-000 → 501-00-000 → 500-000-000 (género).</item>
///   <item><b>Unidades de negocio</b> con segmentos que se agregan:
///         100-001-002 → 100-001 → 100.</item>
/// </list>
/// El padre se deduce de la clave: no hay que capturarlo ni mantenerlo.
/// </summary>
public static class Claves
{
    public static string[] Segmentos(string clave) => clave.Trim().Split('-', StringSplitOptions.RemoveEmptyEntries);

    /// <summary>Unidad padre: la clave sin su último segmento (null en la raíz).</summary>
    public static string? PadreUnidad(string clave)
    {
        var s = Segmentos(clave);
        return s.Length <= 1 ? null : string.Join('-', s[..^1]);
    }

    public static int NivelUnidad(string clave) => Segmentos(clave).Length;

    /// <summary>La unidad y sus ancestros, de la más específica a la raíz.</summary>
    public static IEnumerable<string> LineaUnidad(string clave)
    {
        for (string? c = string.Join('-', Segmentos(clave)); c is not null; c = PadreUnidad(c)) yield return c;
    }

    /// <summary>Ancestro de la unidad en el nivel indicado (1 = raíz), o la propia si es menos profunda.</summary>
    public static string UnidadEnNivel(string clave, int nivel)
    {
        var s = Segmentos(clave);
        return string.Join('-', s[..Math.Min(nivel, s.Length)]);
    }

    /// <summary>
    /// Clave sin los segmentos finales en cero: 501-01-000 → 501-01, 500-000-000 → 500.
    /// Permite que catálogos con segmentos de distinto ancho (500-000-000 y 501-00-000) se enlacen.
    /// </summary>
    public static string NormalizarCuenta(string clave)
    {
        var s = Segmentos(clave).ToList();
        while (s.Count > 1 && s[^1].All(ch => ch == '0')) s.RemoveAt(s.Count - 1);
        return string.Join('-', s);
    }

    /// <summary>
    /// Cuenta padre (normalizada): quita el último segmento; una cuenta de mayor (501) tiene
    /// por padre a su género (500).
    /// </summary>
    public static string? PadreCuenta(string clave)
    {
        var s = Segmentos(NormalizarCuenta(clave));
        if (s.Length > 1) return string.Join('-', s[..^1]);
        var mayor = s[0];
        if (mayor.Length < 2) return null;
        var genero = mayor[0] + new string('0', mayor.Length - 1);
        return genero == mayor ? null : genero;
    }

    public static IEnumerable<string> LineaCuenta(string clave)
    {
        for (string? c = NormalizarCuenta(clave); c is not null; c = PadreCuenta(c)) yield return c;
    }

    public static int NivelCuenta(string clave) => LineaCuenta(clave).Count();
}
