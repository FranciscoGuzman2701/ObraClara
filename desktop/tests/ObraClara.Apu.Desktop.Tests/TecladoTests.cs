using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using ObraClara.Apu.Desktop.Comportamientos;
using ObraClara.Apu.Desktop.ViewModels;
using ObraClara.Apu.Desktop.Views;

namespace ObraClara.Apu.Desktop.Tests;

/// <summary>Navegación tipo hoja de cálculo sobre la ventana real, con teclado simulado.</summary>
public class TecladoTests
{
    private static (MainWindow Ventana, MainWindowViewModel Vm, DataGrid Grid) Abrir(string clave = "BAS-MOR14")
    {
        var vm = App.CrearViewModelAsync(null).GetAwaiter().GetResult();
        vm.Seleccionado = vm.Insumos.Single(f => f.Clave == clave);
        var ventana = new MainWindow { DataContext = vm };
        ventana.Show();
        ventana.UpdateLayout();                      // sin pantalla, los renglones se materializan al medir
        var grid = ventana.FindControl<DataGrid>("GridComponentes")!;
        Clic(ventana, grid, renglon: 0, columna: "Cantidad");
        return (ventana, vm, grid);
    }

    /// <summary>
    /// Deja una celda como actual con el foco dentro de la grilla, como tras un clic del usuario
    /// (el clic simulado sin pantalla no es confiable con la grilla virtualizada).
    /// </summary>
    private static void Clic(MainWindow v, DataGrid grid, int renglon, string columna)
    {
        var item = grid.ItemsSource!.Cast<object>().ElementAt(renglon);
        var destino = grid.Columns.Single(c => (string)c.Header! == columna);
        grid.SelectedIndex = renglon;
        grid.CurrentColumn = destino;
        v.UpdateLayout();
        var fila = grid.GetVisualDescendants().OfType<DataGridRow>().Single(r => ReferenceEquals(r.DataContext, item));
        var celda = fila.GetVisualDescendants().OfType<DataGridCellsPresenter>().Single().Children[grid.Columns.IndexOf(destino)];
        celda.Focus();
        Dispatcher.UIThread.RunJobs();
        v.UpdateLayout();
        Assert.Equal(renglon, grid.SelectedIndex);
        Assert.Equal(columna, grid.CurrentColumn.Header);
        Assert.True(grid.IsKeyboardFocusWithin);
    }

    private static void Tecla(MainWindow v, Key k, RawInputModifiers m = RawInputModifiers.None)
    {
        v.KeyPress(k, m, PhysicalKey.None, null);
        v.KeyRelease(k, m, PhysicalKey.None, null);
        Dispatcher.UIThread.RunJobs();
        v.UpdateLayout();
    }

    private static void Escribir(MainWindow v, string texto)
    {
        v.KeyTextInput(texto);
        Dispatcher.UIThread.RunJobs();
        v.UpdateLayout();
    }

    [AvaloniaFact]
    public void Escribir_sobre_la_celda_la_edita_y_Enter_confirma_y_baja()
    {
        var (v, vm, grid) = Abrir();
        var cemento = vm.Componentes[0];
        Assert.Equal("MAT-CEM", cemento.Clave);
        var antes = vm.Seleccionado!.CostoDirecto;

        Escribir(v, "0");
        Assert.True(NavegacionHojaCalculo.EstaEditando(grid));
        Escribir(v, ".5");
        Tecla(v, Key.Enter);

        Assert.False(NavegacionHojaCalculo.EstaEditando(grid));
        Assert.Equal(0.5m, cemento.Cantidad);
        Assert.Equal(1, grid.SelectedIndex);                         // bajó al siguiente renglón
        Assert.Equal("Cantidad", grid.CurrentColumn.Header);          // en la misma columna
        Assert.True(vm.Seleccionado.CostoDirecto > antes);            // y recalculó al instante
    }

    [AvaloniaFact]
    public void Tab_avanza_por_columnas_editables_y_cambia_de_renglon_al_final()
    {
        var (v, _, grid) = Abrir();
        Tecla(v, Key.Tab);
        Assert.Equal("Rendimiento", grid.CurrentColumn.Header);
        Tecla(v, Key.Tab);
        Assert.Equal("Merma %", grid.CurrentColumn.Header);
        Tecla(v, Key.Tab);                                           // de la última editable a la primera del siguiente
        Assert.Equal("Clave", grid.CurrentColumn.Header);
        Assert.Equal(1, grid.SelectedIndex);
        Tecla(v, Key.Tab, RawInputModifiers.Shift);
        Assert.Equal("Merma %", grid.CurrentColumn.Header);
        Assert.Equal(0, grid.SelectedIndex);
    }

    [AvaloniaFact]
    public void Enter_en_el_ultimo_renglon_agrega_uno_nuevo_y_Supr_lo_quita()
    {
        var (v, vm, grid) = Abrir();
        var n = vm.Componentes.Count;
        Clic(v, grid, renglon: n - 1, columna: "Cantidad");

        Tecla(v, Key.Enter);
        Assert.Equal(n + 1, vm.Componentes.Count);
        Assert.True(vm.Componentes[^1].EsNuevo);
        Assert.Equal(n, grid.SelectedIndex);

        Tecla(v, Key.Delete);
        Assert.Equal(n, vm.Componentes.Count);
    }

    [AvaloniaFact]
    public void Esc_cancela_la_edicion_sin_cambiar_el_valor()
    {
        var (v, vm, grid) = Abrir();
        var original = vm.Componentes[0].Cantidad;
        Escribir(v, "9");
        Tecla(v, Key.Escape);
        Assert.False(NavegacionHojaCalculo.EstaEditando(grid));
        Assert.Equal(original, vm.Componentes[0].Cantidad);
    }

    [AvaloniaFact]
    public void Captura_de_pantalla_de_la_ventana()
    {
        var (v, _, _) = Abrir("CON-MUR14");
        v.Width = 1440;
        v.Height = 860;
        Dispatcher.UIThread.RunJobs();
        var cuadro = v.CaptureRenderedFrame();
        Assert.NotNull(cuadro);
        var ruta = Environment.GetEnvironmentVariable("APU_CAPTURAS");
        if (ruta is null) return;
        cuadro!.Save(Path.Combine(ruta, "ventana-principal.png"));
        var pestanas = v.GetVisualDescendants().OfType<TabControl>().First();
        foreach (var (indice, nombre) in new[] { (1, "presupuesto"), (2, "explosion") })
        {
            pestanas.SelectedIndex = indice;
            Dispatcher.UIThread.RunJobs();
            v.UpdateLayout();
            v.CaptureRenderedFrame()!.Save(Path.Combine(ruta, $"{nombre}.png"));
        }
    }
}
