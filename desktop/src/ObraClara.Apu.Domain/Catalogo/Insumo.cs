namespace ObraClara.Apu.Domain.Catalogo;

/// <summary>
/// Renglón de una matriz de precio unitario. La cantidad efectiva por unidad del padre es
/// (1 / rendimiento, si se capturó rendimiento; si no, la cantidad) × (1 + merma).
/// </summary>
public sealed record ComponenteApu
{
    public required int HijoId { get; init; }
    /// <summary>Cantidad del hijo por unidad del padre (se ignora si hay rendimiento).</summary>
    public decimal Cantidad { get; init; }
    /// <summary>Unidades del padre por unidad del hijo (p. ej. 8 m²/jor). Opcional.</summary>
    public decimal? Rendimiento { get; init; }
    /// <summary>Merma y desperdicio como fracción (0.03 = 3 %).</summary>
    public decimal TasaMerma { get; init; }
    public int Orden { get; init; }

    public decimal CantidadEfectiva =>
        (Rendimiento is > 0 ? 1m / Rendimiento.Value : Cantidad) * (1m + TasaMerma);

    public void Validar()
    {
        if (Rendimiento is null && Cantidad <= 0) throw new ReglaDeNegocioException("La cantidad debe ser mayor a cero");
        if (Rendimiento is <= 0) throw new ReglaDeNegocioException("El rendimiento debe ser mayor a cero");
        if (TasaMerma is < 0 or >= 1) throw new ReglaDeNegocioException("La merma debe estar entre 0 y 1");
    }
}

/// <summary>Mano de obra con salario real calculado por FSR.</summary>
public sealed record DatosManoObra(decimal SalarioNominal, int ParametrosFsrId);

/// <summary>
/// Insumo del catálogo maestro. Elementales (MAT, MO, EQ) y compuestos (BAS, CON) comparten
/// clave única; los compuestos llevan su matriz de componentes.
/// </summary>
public sealed class Insumo
{
    private readonly List<ComponenteApu> _componentes = [];

    public Insumo(int id, string clave, string descripcion, string unidad, TipoInsumo tipo)
    {
        if (string.IsNullOrWhiteSpace(clave)) throw new ReglaDeNegocioException("La clave es obligatoria");
        if (string.IsNullOrWhiteSpace(unidad)) throw new ReglaDeNegocioException($"{clave}: la unidad es obligatoria");
        Id = id;
        Clave = clave.Trim();
        Descripcion = descripcion;
        Unidad = unidad;
        Tipo = tipo;
    }

    public int Id { get; }
    public string Clave { get; }
    public string Descripcion { get; set; }
    public string Unidad { get; }
    public TipoInsumo Tipo { get; }

    /// <summary>
    /// MAT: precio puesto en obra. MO sin FSR y EQ sin análisis: costo capturado directamente.
    /// En compuestos no se usa (su costo sale de la matriz).
    /// </summary>
    public decimal PrecioBase { get; private set; }

    /// <summary>Herramienta menor como fracción de la mano de obra del compuesto.</summary>
    public decimal TasaHerramienta { get; private set; }
    /// <summary>Equipo de seguridad como fracción de la mano de obra del compuesto.</summary>
    public decimal TasaEquipoSeguridad { get; private set; }

    public DatosManoObra? ManoObra { get; private set; }
    public ParametrosCostoHorario? Maquinaria { get; private set; }
    public IReadOnlyList<ComponenteApu> Componentes => _componentes;

    public void FijarPrecioBase(decimal precio)
    {
        if (Tipo.EsCompuesto()) throw new ReglaDeNegocioException($"{Clave}: el costo de un compuesto sale de su matriz");
        if (precio < 0) throw new ReglaDeNegocioException($"{Clave}: el precio no puede ser negativo");
        PrecioBase = precio;
    }

    public void FijarCargosSobreManoObra(decimal tasaHerramienta, decimal tasaEquipoSeguridad)
    {
        if (!Tipo.EsCompuesto()) throw new ReglaDeNegocioException($"{Clave}: sólo los compuestos llevan herramienta y equipo de seguridad");
        if (tasaHerramienta is < 0 or > 1 || tasaEquipoSeguridad is < 0 or > 1)
            throw new ReglaDeNegocioException($"{Clave}: los cargos deben estar entre 0 y 1");
        TasaHerramienta = tasaHerramienta;
        TasaEquipoSeguridad = tasaEquipoSeguridad;
    }

    public void FijarManoObra(DatosManoObra datos)
    {
        if (Tipo != TipoInsumo.MO) throw new ReglaDeNegocioException($"{Clave}: el FSR sólo aplica a mano de obra");
        if (datos.SalarioNominal <= 0) throw new ReglaDeNegocioException($"{Clave}: el salario nominal debe ser mayor a cero");
        ManoObra = datos;
    }

    public void FijarMaquinaria(ParametrosCostoHorario datos)
    {
        if (Tipo != TipoInsumo.EQ) throw new ReglaDeNegocioException($"{Clave}: el costo horario sólo aplica a maquinaria y equipo");
        datos.Validar();
        Maquinaria = datos;
    }

    /// <summary>Uso interno de <see cref="CatalogoInsumos"/>, que valida tipos y ciclos.</summary>
    internal void AgregarComponenteSinValidarGrafo(ComponenteApu c)
    {
        if (!Tipo.EsCompuesto()) throw new ReglaDeNegocioException($"{Clave}: sólo los compuestos tienen matriz");
        c.Validar();
        if (_componentes.Any(x => x.HijoId == c.HijoId))
            throw new ReglaDeNegocioException($"{Clave}: el insumo ya está en la matriz; modifique su cantidad");
        _componentes.Add(c with { Orden = c.Orden == 0 ? _componentes.Count + 1 : c.Orden });
    }

    internal void ReemplazarComponente(ComponenteApu c)
    {
        c.Validar();
        var i = _componentes.FindIndex(x => x.HijoId == c.HijoId);
        if (i < 0) throw new ReglaDeNegocioException($"{Clave}: el componente no existe");
        _componentes[i] = c with { Orden = _componentes[i].Orden };
    }

    internal bool QuitarComponente(int hijoId) => _componentes.RemoveAll(x => x.HijoId == hijoId) > 0;

    /// <summary>Insumos de los que depende el costo de éste (matriz o datos de maquinaria).</summary>
    public IEnumerable<int> Dependencias() =>
        Tipo.EsCompuesto() ? _componentes.Select(c => c.HijoId) : Maquinaria?.Dependencias() ?? [];

    public override string ToString() => $"{Clave} {Descripcion}";
}
