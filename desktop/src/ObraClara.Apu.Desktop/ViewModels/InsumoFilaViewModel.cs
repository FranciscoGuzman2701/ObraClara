using CommunityToolkit.Mvvm.ComponentModel;
using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Desktop.ViewModels;

/// <summary>Renglón del catálogo. Los costos se leen del resultado del motor; Refrescar() avisa a la vista.</summary>
public sealed partial class InsumoFilaViewModel(Insumo insumo, MainWindowViewModel raiz) : ObservableObject
{
    public Insumo Insumo { get; } = insumo;
    public int Id => Insumo.Id;
    public string Clave => Insumo.Clave;
    public string Descripcion => Insumo.Descripcion;
    public string Unidad => Insumo.Unidad;
    public TipoInsumo Tipo => Insumo.Tipo;
    public bool EsCompuesto => Tipo.EsCompuesto();

    /// <summary>MAT, MO sin FSR y EQ sin costo horario se capturan directamente.</summary>
    public bool PrecioEditable => Insumo.Tipo == TipoInsumo.MAT
        || (Insumo.Tipo == TipoInsumo.MO && Insumo.ManoObra is null)
        || (Insumo.Tipo == TipoInsumo.EQ && Insumo.Maquinaria is null);

    public string Origen => Insumo switch
    {
        { Tipo: TipoInsumo.MO, ManoObra: not null } => "FSR",
        { Tipo: TipoInsumo.EQ, Maquinaria: not null } => "Costo horario",
        { Tipo: TipoInsumo.BAS or TipoInsumo.CON } => "Matriz",
        _ => "Capturado",
    };

    /// <summary>Precio capturado; para insumos calculados muestra el costo y no admite edición.</summary>
    public decimal Precio
    {
        get => PrecioEditable ? Insumo.PrecioBase : CostoDirecto;
        set
        {
            if (!PrecioEditable)
            {
                raiz.Error = $"El costo de {Clave} se calcula ({Origen}); edite sus datos, no el resultado";
                OnPropertyChanged();
                return;
            }
            if (value == Insumo.PrecioBase) return;
            _ = raiz.Ejecutar(() => raiz.Sesion.CambiarPrecioAsync(Id, value), $"Precio de {Clave} actualizado");
        }
    }

    public decimal CostoDirecto => raiz.Sesion.Costos.CostoDirecto(Id);
    public decimal Material => raiz.Sesion.Costos.Desglose(Id).Materiales;
    public decimal ManoObra => raiz.Sesion.Costos.Desglose(Id).ManoObra;
    public decimal Equipo => raiz.Sesion.Costos.Desglose(Id).Equipo;
    public decimal Herramienta => raiz.Sesion.Costos.Desglose(Id).Herramienta;
    public decimal EquipoSeguridad => raiz.Sesion.Costos.Desglose(Id).EquipoSeguridad;

    public void Refrescar() => OnPropertyChanged(string.Empty);
}
