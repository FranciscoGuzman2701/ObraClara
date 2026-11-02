using System.Collections.ObjectModel;
using Avalonia.Collections;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using ObraClara.Apu.Application;
using ObraClara.Apu.Domain;
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

    public MainWindowViewModel(SesionCatalogo sesion, string origen)
    {
        Sesion = sesion;
        Origen = origen;
        Insumos = [];
        InsumosVista = new DataGridCollectionView(Insumos) { Filter = o => Coincide((InsumoFilaViewModel)o) };
        CargarCatalogo();
        sesion.CostosActualizados += AlActualizarCostos;
        sesion.Recargado += () => { CargarCatalogo(); RecargarComponentes(); };
    }

    public SesionCatalogo Sesion { get; }
    public string Origen { get; }
    public string Titulo => $"ObraClara Precios Unitarios — {Origen}";

    public ObservableCollection<InsumoFilaViewModel> Insumos { get; }
    public DataGridCollectionView InsumosVista { get; }
    public ObservableCollection<ComponenteFilaViewModel> Componentes { get; } = [];
    public ObservableCollection<PartidaFila> Partidas { get; } = [];
    public ObservableCollection<InsumoExplosionado> Explosion { get; } = [];

    [ObservableProperty] private string _busqueda = "";
    [ObservableProperty] private InsumoFilaViewModel? _seleccionado;
    [ObservableProperty] private string? _mensaje;
    [ObservableProperty] private string? _error;
    [ObservableProperty] private decimal _totalPresupuesto;
    [ObservableProperty] private decimal _costoDirectoObra;
    [ObservableProperty] private decimal _herramientaExplosion;

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
