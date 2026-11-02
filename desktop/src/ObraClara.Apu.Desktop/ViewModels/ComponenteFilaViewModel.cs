using CommunityToolkit.Mvvm.ComponentModel;
using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Desktop.ViewModels;

/// <summary>
/// Renglón de la matriz del compuesto seleccionado. Cada edición se valida y aplica de
/// inmediato (con recálculo en cascada); un renglón nuevo se crea al capturar una clave válida.
/// </summary>
public sealed partial class ComponenteFilaViewModel : ObservableObject
{
    private readonly MainWindowViewModel _raiz;
    private readonly int _padreId;
    private Insumo? _hijo;
    private decimal _cantidad;
    private decimal? _rendimiento;
    private decimal _merma;

    public ComponenteFilaViewModel(MainWindowViewModel raiz, int padreId, ComponenteApu? c = null)
    {
        (_raiz, _padreId) = (raiz, padreId);
        if (c is null) return;
        _hijo = raiz.Sesion.Catalogo[c.HijoId];
        (_cantidad, _rendimiento, _merma) = (c.Cantidad, c.Rendimiento, c.TasaMerma);
    }

    public int? HijoId => _hijo?.Id;
    public bool EsNuevo => _hijo is null;

    /// <summary>Se captura la clave del insumo; la descripción, unidad y costo se completan solos.</summary>
    public string Clave
    {
        get => _hijo?.Clave ?? "";
        set
        {
            if (string.Equals(value?.Trim(), _hijo?.Clave, StringComparison.OrdinalIgnoreCase)) return;
            var hijo = _raiz.Sesion.Catalogo.PorClave(value ?? "");
            if (hijo is null)
            {
                _raiz.Error = $"No existe el insumo «{value}»";
                OnPropertyChanged();
                return;
            }
            if (_hijo is not null)
            {
                _raiz.Error = "Para cambiar el insumo, elimine el renglón y agregue otro";
                OnPropertyChanged();
                return;
            }
            _hijo = hijo;
            if (_cantidad <= 0 && _rendimiento is null) _cantidad = 1m;
            Guardar();
        }
    }

    public string Descripcion => _hijo?.Descripcion ?? "";
    public string Unidad => _hijo?.Unidad ?? "";
    public string Tipo => _hijo?.Tipo.ToString() ?? "";

    /// <summary>Cantidad por unidad del padre; si se capturó rendimiento, muestra 1 / rendimiento.</summary>
    public decimal Cantidad
    {
        get => _rendimiento is > 0 ? Math.Round(1m / _rendimiento.Value, 8) : _cantidad;
        set { if (value != Cantidad) { _cantidad = value; _rendimiento = null; Guardar(); } }
    }

    /// <summary>Unidades del padre por unidad del insumo (p. ej. 8 m²/jor). Vacío = usar cantidad.</summary>
    public decimal? Rendimiento
    {
        get => _rendimiento;
        set { if (value != _rendimiento) { _rendimiento = value is > 0 ? value : null; Guardar(); } }
    }

    /// <summary>Merma en por ciento (3 = 3 %).</summary>
    public decimal MermaPorcentaje
    {
        get => _merma * 100m;
        set { if (value / 100m != _merma) { _merma = value / 100m; Guardar(); } }
    }

    public ComponenteApu? Componente => _hijo is null ? null
        : new ComponenteApu { HijoId = _hijo.Id, Cantidad = _cantidad, Rendimiento = _rendimiento, TasaMerma = _merma };

    public decimal CantidadEfectiva => Componente?.CantidadEfectiva ?? 0m;
    public decimal CostoUnitario => _hijo is null ? 0m : _raiz.Sesion.Costos.CostoDirecto(_hijo.Id);
    public decimal Importe => CantidadEfectiva * CostoUnitario;

    private void Guardar()
    {
        if (Componente is not { } c) return;
        _ = _raiz.Ejecutar(() => _raiz.Sesion.GuardarComponenteAsync(_padreId, c), $"Matriz de {_raiz.Sesion.Catalogo[_padreId].Clave} actualizada",
            alFallar: Revertir);
        Refrescar();
    }

    /// <summary>El cambio fue rechazado: vuelve a lo que dice el catálogo (o retira el renglón si no llegó a existir).</summary>
    private void Revertir()
    {
        var guardado = _hijo is null ? null : _raiz.Sesion.Catalogo[_padreId].Componentes.FirstOrDefault(x => x.HijoId == _hijo.Id);
        if (guardado is null)
        {
            _raiz.Componentes.Remove(this);
            return;
        }
        (_cantidad, _rendimiento, _merma) = (guardado.Cantidad, guardado.Rendimiento, guardado.TasaMerma);
        Refrescar();
    }

    public void Refrescar() => OnPropertyChanged(string.Empty);
}
