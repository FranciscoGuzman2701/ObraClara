using Avalonia;
using Avalonia.Controls;

namespace ObraClara.Apu.Desktop.Comportamientos;

/// <summary>
/// Renglones alternos ("cebra") para leer grillas largas. Se marca cada renglón al
/// cargarse porque la grilla recicla renglones al desplazarse.
/// </summary>
public static class FilasAlternas
{
    public static readonly AttachedProperty<bool> HabilitarProperty =
        AvaloniaProperty.RegisterAttached<DataGrid, bool>("Habilitar", typeof(FilasAlternas));

    public static bool GetHabilitar(DataGrid g) => g.GetValue(HabilitarProperty);
    public static void SetHabilitar(DataGrid g, bool v) => g.SetValue(HabilitarProperty, v);

    static FilasAlternas()
    {
        HabilitarProperty.Changed.AddClassHandler<DataGrid>((grid, e) =>
        {
            if (e.NewValue is true) grid.LoadingRow += (_, a) => a.Row.Classes.Set("alterno", a.Row.Index % 2 == 1);
        });
    }
}
