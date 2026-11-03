namespace ObraClara.Apu.Domain.Contabilidad;

public enum Naturaleza : byte { Deudora = 1, Acreedora = 2 }

/// <summary>Cuenta del catálogo contable (único para toda la empresa).</summary>
public sealed record CuentaContable(string Clave, string Nombre, Naturaleza Naturaleza, bool Afectable,
    string? CodigoAgrupadorSat = null, bool RequiereProyecto = false)
{
    public int Nivel => Claves.NivelCuenta(Clave);
}

/// <summary>Nodo del árbol de unidades de negocio (empresa → zona → tipo de obra …).</summary>
public sealed record UnidadNegocio(string Clave, string Descripcion)
{
    public int Nivel => Claves.NivelUnidad(Clave);
}

/// <summary>Proyecto (obra). Cuelga de una unidad de negocio; puede tener presupuesto de PU.</summary>
public sealed record Proyecto(string Clave, string Nombre, string UnidadNegocio, int? PresupuestoId = null);

/// <summary>
/// Renglón de póliza. La cuenta es una sola para todas las obras: el proyecto es una
/// dimensión del movimiento, no una subcuenta. Opcionalmente, la partida del presupuesto.
/// </summary>
public sealed record Movimiento(string Cuenta, string? Proyecto, decimal Cargo, decimal Abono, string? Partida = null, string? Concepto = null);

public sealed record Poliza(string Folio, DateOnly Fecha, string Concepto, IReadOnlyList<Movimiento> Movimientos, string Origen = "Manual");

/// <summary>
/// Contabilidad de la empresa con dimensiones. Valida al registrar cada póliza:
/// cuadre, cuentas afectables, proyecto obligatorio donde la cuenta lo exige, catálogos existentes.
/// </summary>
public sealed class LibroContable
{
    private readonly Dictionary<string, CuentaContable> _cuentas = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, UnidadNegocio> _unidades = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Proyecto> _proyectos = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<Poliza> _polizas = [];

    public IReadOnlyCollection<CuentaContable> Cuentas => _cuentas.Values;
    public IReadOnlyCollection<UnidadNegocio> Unidades => _unidades.Values;
    public IReadOnlyCollection<Proyecto> Proyectos => _proyectos.Values;
    public IReadOnlyList<Poliza> Polizas => _polizas;

    /// <summary>Busca por la clave normalizada: 501-01-000 y 501-01 son la misma cuenta.</summary>
    public CuentaContable? Cuenta(string clave) => _cuentas.GetValueOrDefault(Claves.NormalizarCuenta(clave));
    public UnidadNegocio? Unidad(string clave) => _unidades.GetValueOrDefault(clave.Trim());
    public Proyecto? ProyectoPor(string clave) => _proyectos.GetValueOrDefault(clave.Trim());

    /// <summary>Alta o actualización de cuenta (importación del catálogo).</summary>
    public void GuardarCuenta(CuentaContable c)
    {
        if (string.IsNullOrWhiteSpace(c.Clave)) throw new ReglaDeNegocioException("La cuenta necesita clave");
        if (c.RequiereProyecto && !c.Afectable) throw new ReglaDeNegocioException($"{c.Clave}: una cuenta de título no recibe movimientos");
        _cuentas[Claves.NormalizarCuenta(c.Clave)] = c with { Clave = c.Clave.Trim() };
    }

    public void GuardarUnidad(UnidadNegocio u)
    {
        var clave = string.Join('-', Claves.Segmentos(u.Clave));
        if (clave.Length == 0) throw new ReglaDeNegocioException("La unidad de negocio necesita clave");
        if (Claves.PadreUnidad(clave) is { } padre && !_unidades.ContainsKey(padre))
            throw new ReglaDeNegocioException($"{clave}: primero dé de alta la unidad {padre}");
        _unidades[clave] = u with { Clave = clave };
    }

    public void GuardarProyecto(Proyecto p)
    {
        if (!_unidades.ContainsKey(p.UnidadNegocio))
            throw new ReglaDeNegocioException($"{p.Clave}: la unidad de negocio {p.UnidadNegocio} no existe");
        _proyectos[p.Clave.Trim()] = p with { Clave = p.Clave.Trim() };
    }

    public void Registrar(Poliza p)
    {
        Validar(p);
        _polizas.Add(p);
    }

    public void Validar(Poliza p)
    {
        if (p.Movimientos.Count < 2) throw new ReglaDeNegocioException($"Póliza {p.Folio}: necesita al menos un cargo y un abono");
        foreach (var (m, i) in p.Movimientos.Select((m, i) => (m, i + 1)))
        {
            var donde = $"Póliza {p.Folio}, renglón {i}";
            if (m.Cargo < 0 || m.Abono < 0 || (m.Cargo == 0) == (m.Abono == 0))
                throw new ReglaDeNegocioException($"{donde}: cada renglón lleva cargo o abono (uno, positivo)");
            var cuenta = Cuenta(m.Cuenta) ?? throw new ReglaDeNegocioException($"{donde}: la cuenta {m.Cuenta} no existe");
            if (!cuenta.Afectable) throw new ReglaDeNegocioException($"{donde}: {cuenta.Clave} es de título; use una subcuenta afectable");
            if (m.Proyecto is { } pr && ProyectoPor(pr) is null) throw new ReglaDeNegocioException($"{donde}: el proyecto {pr} no existe");
            if (cuenta.RequiereProyecto && string.IsNullOrWhiteSpace(m.Proyecto))
                throw new ReglaDeNegocioException($"{donde}: {cuenta.Clave} {cuenta.Nombre} exige proyecto");
        }
        var (cargos, abonos) = (p.Movimientos.Sum(m => m.Cargo), p.Movimientos.Sum(m => m.Abono));
        if (cargos != abonos) throw new ReglaDeNegocioException($"Póliza {p.Folio} descuadrada: cargos {cargos:N2} ≠ abonos {abonos:N2}");
    }
}
