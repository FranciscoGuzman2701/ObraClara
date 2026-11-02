using System.Collections.ObjectModel;
using Avalonia.Collections;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using ObraClara.Apu.Application;
using ObraClara.Apu.Application.Reportes;
using ObraClara.Apu.Domain.Analisis;
using ObraClara.Apu.Infrastructure.Reportes;
using ObraClara.Apu.Domain;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;
using ObraClara.Apu.Domain.Presupuestos;

namespace ObraClara.Apu.Desktop.ViewModels;

public sealed record PartidaFila(int Id, int Nivel, TipoPartida Tipo, string Clave, string Descripcion, string Unidad,
    decimal? Cantidad, decimal? PrecioUnitario, decimal Importe)
{
    /// <summary>Sangría por nivel del árbol (la grilla es plana: virtualiza miles de renglones).</summary>
    public string DescripcionConSangria => new string(' ', Nivel) + Descripcion;
    public bool EsTitulo => Tipo != TipoPartida.Concepto;
}

public sealed partial class MainWindowViewModel : ObservableObject
{
    private readonly Dictionary<int, InsumoFilaViewModel> _filas = [];
    // ruta de navegación al abrir matrices dentro de matrices (F4 entra, Esc regresa)
    private readonly Stack<InsumoFilaViewModel> _historial = new();
    private bool _navegando;

    public MainWindowViewModel(SesionCatalogo sesion, string origen)
    {
        Sesion = sesion;
        Origen = origen;
        Insumos = [];
        InsumosVista = new DataGridCollectionView(Insumos) { Filter = o => Coincide((InsumoFilaViewModel)o) };
        CargarCatalogo();
        sesion.CostosActualizados += AlActualizarCostos;
        sesion.Recargado += () => { CargarCatalogo(); RecargarComponentes(); };
        sesion.ControlActualizado += RecalcularAnalisis;
    }

    public SesionCatalogo Sesion { get; }
    public string Origen { get; }
    public string Titulo => $"ObraClara Precios Unitarios — {Origen}";

    public ObservableCollection<InsumoFilaViewModel> Insumos { get; }
    public DataGridCollectionView InsumosVista { get; }
    public ObservableCollection<ComponenteFilaViewModel> Componentes { get; } = [];
    public ObservableCollection<PartidaFila> Partidas { get; } = [];
    public ObservableCollection<InsumoExplosionado> Explosion { get; } = [];
    public ObservableCollection<BarraTablero> BarrasConceptos { get; } = [];
    public ObservableCollection<BarraTablero> BarrasDesperdicio { get; } = [];
    public ObservableCollection<AnalisisConcepto> AlcanceConceptos { get; } = [];

    /// <summary>Último análisis de obra (avance, costo real y consumos contra el presupuesto).</summary>
    [ObservableProperty] private ResultadoAnalisis? _analisis;
    public bool HayAvances => Sesion.Control.Avances.Count > 0;

    [ObservableProperty] private string _busqueda = "";
    [ObservableProperty] private InsumoFilaViewModel? _seleccionado;
    [ObservableProperty] private string? _mensaje;
    [ObservableProperty] private string? _error;
    [ObservableProperty] private decimal _totalPresupuesto;
    [ObservableProperty] private decimal _costoDirectoObra;
    [ObservableProperty] private decimal _herramientaExplosion;
    [ObservableProperty] private int _pestanaActiva;
    [ObservableProperty] private bool _buscadorVisible;
    [ObservableProperty] private string _textoBuscador = "";
    [ObservableProperty] private InsumoFilaViewModel? _resultadoSeleccionado;
    [ObservableProperty] private bool _atajosVisibles;

    public ObservableCollection<InsumoFilaViewModel> ResultadosBuscador { get; } = [];

    /// <summary>Ruta de matrices abiertas, p. ej. «CON-MUR14 › BAS-MOR14 › BAS-CUA1».</summary>
    public string Ruta => string.Join("  ›  ", _historial.Reverse().Append(Seleccionado).OfType<InsumoFilaViewModel>().Select(f => f.Clave));
    public bool PuedeRegresar => _historial.Count > 0;

    /// <summary>Precio unitario de venta del seleccionado con el sobrecosto del presupuesto abierto.</summary>
    public decimal? PrecioVentaSeleccionado => Seleccionado is { } s && Sesion.Presupuesto is { } p
        ? CalculadoraPrecioVenta.Calcular(s.CostoDirecto, p.Sobrecosto).PrecioUnitario
        : null;

    public string? NombrePresupuesto => Sesion.Presupuesto is { } p ? $"{p.Clave} · {p.Nombre}" : null;

    /// <summary>Herramienta menor del compuesto seleccionado, en por ciento.</summary>
    public decimal HerramientaPorcentaje
    {
        get => (Seleccionado?.Insumo.TasaHerramienta ?? 0) * 100m;
        set => CambiarCargos(value / 100m, Seleccionado?.Insumo.TasaEquipoSeguridad ?? 0);
    }

    public decimal SeguridadPorcentaje
    {
        get => (Seleccionado?.Insumo.TasaEquipoSeguridad ?? 0) * 100m;
        set => CambiarCargos(Seleccionado?.Insumo.TasaHerramienta ?? 0, value / 100m);
    }

    partial void OnBusquedaChanged(string value) => InsumosVista.Refresh();

    partial void OnSeleccionadoChanged(InsumoFilaViewModel? value)
    {
        if (!_navegando) _historial.Clear();      // elegirlo en el catálogo reinicia la ruta
        OnPropertyChanged(nameof(Ruta));
        OnPropertyChanged(nameof(PuedeRegresar));
        OnPropertyChanged(nameof(PrecioVentaSeleccionado));
        RecargarComponentes();
        OnPropertyChanged(nameof(HerramientaPorcentaje));
        OnPropertyChanged(nameof(SeguridadPorcentaje));
    }

    private bool Coincide(InsumoFilaViewModel f) =>
        string.IsNullOrWhiteSpace(Busqueda)
        || f.Clave.Contains(Busqueda.Trim(), StringComparison.OrdinalIgnoreCase)
        || f.Descripcion.Contains(Busqueda.Trim(), StringComparison.OrdinalIgnoreCase);

    private void CargarCatalogo()
    {
        var seleccionado = Seleccionado?.Id;
        _filas.Clear();
        Insumos.Clear();
        foreach (var i in Sesion.Catalogo.Insumos.OrderBy(i => i.Tipo).ThenBy(i => i.Clave, StringComparer.Ordinal))
        {
            var fila = new InsumoFilaViewModel(i, this);
            _filas[i.Id] = fila;
            Insumos.Add(fila);
        }
        Seleccionado = seleccionado is { } id && _filas.TryGetValue(id, out var f) ? f : Insumos.FirstOrDefault(x => x.EsCompuesto);
        RecalcularPresupuesto();
    }

    public void RecargarComponentes()
    {
        Componentes.Clear();
        if (Seleccionado is not { EsCompuesto: true } s) return;
        foreach (var c in s.Insumo.Componentes.OrderBy(c => c.Orden))
            Componentes.Add(new ComponenteFilaViewModel(this, s.Id, c));
    }

    private void AlActualizarCostos(IReadOnlyList<int> recalculados)
    {
        foreach (var id in recalculados)
            if (_filas.TryGetValue(id, out var f)) f.Refrescar();
        foreach (var c in Componentes) c.Refrescar();
        OnPropertyChanged(nameof(PrecioVentaSeleccionado));
        if (Sesion.Presupuesto is { } p && p.Conceptos.Any(c => recalculados.Contains(c.InsumoId!.Value)))
            RecalcularPresupuesto();
    }

    private void RecalcularPresupuesto()
    {
        Partidas.Clear();
        Explosion.Clear();
        if (Sesion.Presupuesto is not { } p || Sesion.CalcularPresupuesto() is not { } r) return;
        void Agregar(int? padre, int nivel)
        {
            foreach (var h in p.Hijas(padre))
            {
                var imp = r.Partidas[h.Id];
                var unidad = h.InsumoId is { } id ? Sesion.Catalogo[id].Unidad : "";
                var esConcepto = h.Tipo == TipoPartida.Concepto;
                Partidas.Add(new PartidaFila(h.Id, nivel, h.Tipo, h.Clave,
                    esConcepto ? Sesion.Catalogo[h.InsumoId!.Value].Descripcion : h.Descripcion, unidad,
                    esConcepto ? h.Cantidad : null, esConcepto ? imp.PrecioUnitario : null, imp.Importe));
                Agregar(h.Id, nivel + 1);
            }
        }
        Agregar(null, 0);
        TotalPresupuesto = r.Total;

        var exp = Sesion.Explosionar()!;
        foreach (var i in exp.Insumos) Explosion.Add(i);
        CostoDirectoObra = exp.CostoDirectoTotal;
        HerramientaExplosion = exp.Herramienta + exp.EquipoSeguridad;
        RecalcularAnalisis();
    }

    private void RecalcularAnalisis()
    {
        BarrasConceptos.Clear();
        BarrasDesperdicio.Clear();
        AlcanceConceptos.Clear();
        Analisis = Sesion.Analizar();
        OnPropertyChanged(nameof(HayAvances));
        if (Analisis is not { } a) return;
        foreach (var b in Tablero.GananciasPerdidas(a)) BarrasConceptos.Add(b);
        foreach (var b in Tablero.Desperdicio(a)) BarrasDesperdicio.Add(b);
        foreach (var c in a.Conceptos) AlcanceConceptos.Add(c);
    }

    // ------------------------------------------------------------ descargas e importación

    public static string NombreSugerido(TipoExportacion t, string obra) => t switch
    {
        TipoExportacion.ReportePdf => $"{obra}-reporte.pdf",
        TipoExportacion.PresupuestoCsv => $"{obra}-presupuesto.csv",
        TipoExportacion.ExplosionCsv => $"{obra}-explosion.csv",
        TipoExportacion.AnalisisCsv => $"{obra}-analisis-conceptos.csv",
        _ => $"{obra}-desperdicio.csv",
    };

    public string ClaveObra => Sesion.Presupuesto?.Clave ?? "obra";

    /// <summary>Contenido del archivo a descargar (PDF o CSV para Excel / Power BI).</summary>
    public byte[] Exportar(TipoExportacion tipo)
    {
        if (Sesion.Presupuesto is not { } p) throw new ReglaDeNegocioException("No hay presupuesto abierto");
        var importes = Sesion.CalcularPresupuesto()!;
        var analisis = Sesion.Analizar()!;
        return tipo switch
        {
            TipoExportacion.ReportePdf => ReportePdf.Generar(new ReportePdf.Datos(p, Sesion.Catalogo, importes, Sesion.Explosionar()!,
                HayAvances ? analisis : null, DateTime.Now)),
            TipoExportacion.PresupuestoCsv => Csv.ABytes(ExportadorCsv.Presupuesto(p, Sesion.Catalogo, importes)),
            TipoExportacion.ExplosionCsv => Csv.ABytes(ExportadorCsv.Explosion(Sesion.Explosionar()!)),
            TipoExportacion.AnalisisCsv => Csv.ABytes(ExportadorCsv.AnalisisConceptos(analisis)),
            _ => Csv.ABytes(ExportadorCsv.Desperdicio(analisis)),
        };
    }

    /// <summary>Importa avances (obra/compras) o consumos (almacén) desde CSV.</summary>
    public async Task ImportarCsvAsync(string texto, string nombreArchivo)
    {
        Error = null;
        try
        {
            var r = await Sesion.ImportarControlAsync(texto);
            if (r.Errores.Count > 0)
                Error = $"{nombreArchivo}: no se importó nada, corrija {r.Errores.Count} línea(s). {string.Join(" · ", r.Errores.Take(3))}";
            else
                Mensaje = $"{nombreArchivo}: {r.Avances.Count} avance(s) y {r.Consumos.Count} consumo(s) importados";
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            Error = $"No se pudo importar {nombreArchivo}: {ex.Message}";
        }
    }

    [RelayCommand]
    private void AgregarComponente()
    {
        if (Seleccionado is not { EsCompuesto: true } s) return;
        if (Componentes.Any(c => c.EsNuevo)) return;   // un renglón vacío a la vez
        Componentes.Add(new ComponenteFilaViewModel(this, s.Id));
    }

    [RelayCommand]
    private void QuitarComponente(ComponenteFilaViewModel? fila)
    {
        if (fila is null || Seleccionado is not { } s) return;
        if (fila.HijoId is { } hijoId)
            _ = Ejecutar(() => Sesion.QuitarComponenteAsync(s.Id, hijoId), $"{fila.Clave} quitado de {s.Clave}", RecargarComponentes);
        Componentes.Remove(fila);
    }

    // ------------------------------------------------------------ forma de trabajo con teclas de función

    /// <summary>F4: abre la matriz del componente (básico o concepto) para revisarla o editarla.</summary>
    [RelayCommand]
    private void AbrirMatriz(ComponenteFilaViewModel? fila)
    {
        if (fila?.HijoId is not { } id || !_filas.TryGetValue(id, out var destino)) return;
        if (!destino.EsCompuesto)
        {
            Mensaje = $"{destino.Clave} es {destino.Tipo}: su costo es {destino.Origen.ToLowerInvariant()}, no tiene matriz";
            return;
        }
        Navegar(destino, apilar: true);
    }

    /// <summary>F4 en el presupuesto: abre la matriz del concepto en el catálogo.</summary>
    [RelayCommand]
    private void AbrirConcepto(PartidaFila? partida)
    {
        if (partida is not { Tipo: TipoPartida.Concepto } || Sesion.Presupuesto is null) return;
        var insumoId = Sesion.Presupuesto.Partidas.Single(x => x.Id == partida.Id).InsumoId!.Value;
        Seleccionado = _filas[insumoId];
        PestanaActiva = 0;
    }

    /// <summary>Esc: regresa a la matriz anterior de la ruta.</summary>
    [RelayCommand]
    private void Regresar()
    {
        if (_historial.Count > 0) Navegar(_historial.Pop(), apilar: false);
    }

    private void Navegar(InsumoFilaViewModel destino, bool apilar)
    {
        _navegando = true;
        try
        {
            if (apilar && Seleccionado is not null) _historial.Push(Seleccionado);
            Seleccionado = destino;
            OnPropertyChanged(nameof(Ruta));
            OnPropertyChanged(nameof(PuedeRegresar));
        }
        finally { _navegando = false; }
    }

    /// <summary>F3: buscador de insumos para agregar a la matriz sin recordar claves.</summary>
    [RelayCommand]
    private void AbrirBuscador()
    {
        if (Seleccionado is not { EsCompuesto: true })
        {
            Mensaje = "Seleccione un básico o concepto para agregarle insumos";
            return;
        }
        TextoBuscador = "";
        FiltrarBuscador();
        BuscadorVisible = true;
    }

    [RelayCommand]
    private void CerrarBuscador() => BuscadorVisible = false;

    partial void OnTextoBuscadorChanged(string value) => FiltrarBuscador();

    private void FiltrarBuscador()
    {
        ResultadosBuscador.Clear();
        var texto = TextoBuscador.Trim();
        // un concepto no puede ser componente y un compuesto no se contiene a sí mismo
        foreach (var f in Insumos.Where(f => f.Tipo != TipoInsumo.CON && f.Id != Seleccionado?.Id)
                     .Where(f => texto.Length == 0
                                 || f.Clave.Contains(texto, StringComparison.OrdinalIgnoreCase)
                                 || f.Descripcion.Contains(texto, StringComparison.OrdinalIgnoreCase))
                     .Take(200))
            ResultadosBuscador.Add(f);
        ResultadoSeleccionado = ResultadosBuscador.FirstOrDefault();
    }

    /// <summary>Enter en el buscador: agrega el insumo elegido a la matriz con cantidad 1 (luego se ajusta en la celda).</summary>
    [RelayCommand]
    private void ElegirInsumo(InsumoFilaViewModel? elegido)
    {
        elegido ??= ResultadoSeleccionado;
        if (elegido is null || Seleccionado is not { EsCompuesto: true } s) return;
        BuscadorVisible = false;
        if (Componentes.FirstOrDefault(c => c.HijoId == elegido.Id) is { } existente)
        {
            Mensaje = $"{elegido.Clave} ya está en la matriz de {s.Clave}; ajuste su cantidad";
            ComponenteEnfocado = existente;
            return;
        }
        var fila = Componentes.FirstOrDefault(c => c.EsNuevo) ?? new ComponenteFilaViewModel(this, s.Id);
        if (!Componentes.Contains(fila)) Componentes.Add(fila);
        fila.Clave = elegido.Clave;
        ComponenteEnfocado = Componentes.Contains(fila) ? fila : null;
    }

    /// <summary>Renglón que la vista debe enfocar tras agregar desde el buscador.</summary>
    [ObservableProperty] private ComponenteFilaViewModel? _componenteEnfocado;

    /// <summary>F9: recalcula todo el catálogo y el presupuesto.</summary>
    [RelayCommand]
    private Task RecalcularTodo() =>
        Ejecutar(Sesion.RecalcularTodoAsync, $"Catálogo recalculado: {Insumos.Count:N0} insumos");

    /// <summary>F1: muestra u oculta la tabla de atajos.</summary>
    [RelayCommand]
    private void AlternarAtajos() => AtajosVisibles = !AtajosVisibles;

    private void CambiarCargos(decimal herramienta, decimal seguridad)
    {
        if (Seleccionado is not { EsCompuesto: true } s) return;
        _ = Ejecutar(() => Sesion.CambiarCargosAsync(s.Id, herramienta, seguridad), $"Cargos de {s.Clave} actualizados");
        OnPropertyChanged(nameof(HerramientaPorcentaje));
        OnPropertyChanged(nameof(SeguridadPorcentaje));
    }

    /// <summary>
    /// Ejecuta un cambio. La parte local (validación + recálculo) corre de inmediato;
    /// la persistencia en SQL Server, si la hay, termina en segundo plano.
    /// </summary>
    public async Task Ejecutar(Func<Task> accion, string mensajeOk, Action? alFallar = null)
    {
        Error = null;
        try
        {
            await accion();
            Mensaje = mensajeOk;
        }
        catch (ReglaDeNegocioException ex)
        {
            Error = ex.Message;
            alFallar?.Invoke();
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            Error = $"No se pudo guardar: {ex.Message}";
            alFallar?.Invoke();
        }
    }
}
