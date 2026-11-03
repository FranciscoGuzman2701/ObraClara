namespace ObraClara.Apu.Domain.Contabilidad;

/// <summary>Cómo se forman las columnas de la balanza horizontal.</summary>
public sealed record Agrupacion(string Nombre, Func<LibroContable, Proyecto?, string> Columna)
{
    public const string SinProyecto = "(sin proyecto)";

    /// <summary>Por nodo del árbol de unidades en un nivel: 1 = empresa, 2 = zona, 3 = zona y tipo de obra…</summary>
    public static Agrupacion PorNivel(int nivel, string nombre) => new(nombre, (libro, p) =>
    {
        if (p is null) return SinProyecto;
        var clave = Claves.UnidadEnNivel(p.UnidadNegocio, nivel);
        return $"{clave} {libro.Unidad(clave)?.Descripcion}".Trim();
    });

    /// <summary>
    /// Por la descripción del nodo en un nivel, sumando entre ramas: con "100-001-001 OBRA PUBLICA"
    /// y "100-002-001 OBRA PUBLICA", toda la obra pública del país queda en una columna.
    /// </summary>
    public static Agrupacion PorDescripcionEnNivel(int nivel, string nombre) => new(nombre, (libro, p) =>
    {
        if (p is null) return SinProyecto;
        if (Claves.NivelUnidad(p.UnidadNegocio) < nivel) return "(otras)";
        return libro.Unidad(Claves.UnidadEnNivel(p.UnidadNegocio, nivel))?.Descripcion.Trim().ToUpperInvariant() ?? "(otras)";
    });

    public static Agrupacion PorProyecto { get; } = new("Proyecto", (_, p) => p is null ? SinProyecto : $"{p.Clave} {p.Nombre}");
}

public sealed record FilaReporte(string Cuenta, string Nombre, int Nivel, bool Afectable, decimal Total, IReadOnlyDictionary<string, decimal> PorColumna)
{
    public decimal this[string columna] => PorColumna.GetValueOrDefault(columna);
}

public sealed record ReporteSaldos(string Agrupacion, IReadOnlyList<string> Columnas, IReadOnlyList<FilaReporte> Filas);

public static class Reportes
{
    /// <summary>
    /// Balanza horizontal: cuentas en renglones (con sus cuentas de título sumadas) y la
    /// agrupación elegida en columnas, sobre una sola cuenta por concepto contable.
    /// Saldo según la naturaleza: deudora = cargos − abonos; acreedora = abonos − cargos.
    /// </summary>
    public static ReporteSaldos Balanza(LibroContable libro, Agrupacion agrupacion,
        DateOnly? desde = null, DateOnly? hasta = null, string? prefijoCuenta = null, int? nivelMaximo = null)
    {
        var celdas = new Dictionary<(string Cuenta, string Columna), decimal>();
        foreach (var p in libro.Polizas.Where(p => (desde is null || p.Fecha >= desde) && (hasta is null || p.Fecha <= hasta)))
            foreach (var m in p.Movimientos)
            {
                var columna = agrupacion.Columna(libro, m.Proyecto is { } pr ? libro.ProyectoPor(pr) : null);
                foreach (var cuenta in Claves.LineaCuenta(m.Cuenta))
                {
                    if (libro.Cuenta(cuenta) is not { } c) continue;
                    var saldo = c.Naturaleza == Naturaleza.Deudora ? m.Cargo - m.Abono : m.Abono - m.Cargo;
                    celdas[(c.Clave, columna)] = celdas.GetValueOrDefault((c.Clave, columna)) + saldo;
                }
            }

        var columnas = celdas.Keys.Select(k => k.Columna).Distinct()
            .OrderBy(c => c == Agrupacion.SinProyecto).ThenBy(c => c, StringComparer.Ordinal).ToList();
        var filas = celdas.Keys.Select(k => k.Cuenta).Distinct()
            .Select(clave => libro.Cuenta(clave)!)
            .Where(c => prefijoCuenta is null || c.Clave.StartsWith(prefijoCuenta, StringComparison.OrdinalIgnoreCase)
                        || c.Nombre.Contains(prefijoCuenta, StringComparison.OrdinalIgnoreCase))
            .Where(c => nivelMaximo is null || c.Nivel <= nivelMaximo)
            .OrderBy(c => c.Clave, StringComparer.Ordinal)
            .Select(c =>
            {
                var porColumna = columnas.ToDictionary(col => col, col => celdas.GetValueOrDefault((c.Clave, col)));
                return new FilaReporte(c.Clave, c.Nombre, c.Nivel, c.Afectable, porColumna.Values.Sum(), porColumna);
            })
            .ToList();
        return new ReporteSaldos(agrupacion.Nombre, columnas, filas);
    }

    /// <summary>Costo contable por proyecto: saldo de las cuentas de costo (por omisión, género 5).</summary>
    public static IReadOnlyDictionary<string, decimal> CostoPorProyecto(LibroContable libro, string prefijoCostos = "5")
    {
        var r = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var m in libro.Polizas.SelectMany(p => p.Movimientos))
        {
            if (m.Proyecto is not { } pr || !m.Cuenta.StartsWith(prefijoCostos, StringComparison.Ordinal)) continue;
            var c = libro.Cuenta(m.Cuenta)!;
            r[pr] = r.GetValueOrDefault(pr) + (c.Naturaleza == Naturaleza.Deudora ? m.Cargo - m.Abono : m.Abono - m.Cargo);
        }
        return r;
    }
}
