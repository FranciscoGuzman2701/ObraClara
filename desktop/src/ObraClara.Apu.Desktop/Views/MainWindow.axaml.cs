using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using ObraClara.Apu.Desktop.Comportamientos;
using ObraClara.Apu.Desktop.ViewModels;

namespace ObraClara.Apu.Desktop.Views;

/// <summary>
/// Forma de trabajo con teclas de función, al estilo de los programas de precios unitarios:
/// F3 buscar insumo, F4 abrir matriz, Esc regresar, F9 recalcular, F1 atajos.
/// </summary>
public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        AddHandler(KeyDownEvent, AlPresionarTecla, RoutingStrategies.Tunnel);
        TextoBuscador.KeyDown += TeclaEnBuscador;
        ListaBuscador.KeyDown += TeclaEnBuscador;
        ListaBuscador.DoubleTapped += (_, _) => Vm?.ElegirInsumoCommand.Execute(null);
        GridComponentes.DoubleTapped += (_, e) =>
        {
            if (!NavegacionHojaCalculo.EstaEditando(GridComponentes)) Vm?.AbrirMatrizCommand.Execute(GridComponentes.SelectedItem);
        };
        GridPresupuesto.DoubleTapped += (_, _) => Vm?.AbrirConceptoCommand.Execute(GridPresupuesto.SelectedItem);
    }

    private MainWindowViewModel? Vm => DataContext as MainWindowViewModel;

    private void AlPresionarTecla(object? sender, KeyEventArgs e)
    {
        if (Vm is not { } vm) return;
        if (vm.BuscadorVisible || (vm.AtajosVisibles && e.Key != Key.F1 && e.Key != Key.Escape)) return;
        var ctrl = e.KeyModifiers.HasFlag(KeyModifiers.Control);
        switch (e.Key)
        {
            case Key.F1:
                vm.AlternarAtajosCommand.Execute(null);
                break;
            case Key.Escape when vm.AtajosVisibles:
                vm.AtajosVisibles = false;
                break;
            case Key.F3:
                vm.AbrirBuscadorCommand.Execute(null);
                if (vm.BuscadorVisible) Dispatcher.UIThread.Post(() => TextoBuscador.Focus(), DispatcherPriority.Input);
                break;
            case Key.F4 when vm.PestanaActiva == 1:
                vm.AbrirConceptoCommand.Execute(GridPresupuesto.SelectedItem);
                break;
            case Key.F4:
                vm.AbrirMatrizCommand.Execute(GridComponentes.SelectedItem);
                break;
            // Esc cancela la edición si se está editando; si no, regresa a la matriz anterior
            case Key.Escape when !NavegacionHojaCalculo.EstaEditando(GridComponentes) && !NavegacionHojaCalculo.EstaEditando(GridInsumos) && vm.PuedeRegresar:
                vm.RegresarCommand.Execute(null);
                break;
            case Key.Left when e.KeyModifiers.HasFlag(KeyModifiers.Alt):
                vm.RegresarCommand.Execute(null);
                break;
            case Key.F9:
                vm.RecalcularTodoCommand.Execute(null);
                break;
            case Key.F when ctrl:
                vm.PestanaActiva = 0;
                Buscar.Focus();
                break;
            case Key.D1 or Key.D2 or Key.D3 when ctrl:
                vm.PestanaActiva = e.Key - Key.D1;
                break;
            default:
                return;
        }
        e.Handled = true;
    }

    private void TeclaEnBuscador(object? sender, KeyEventArgs e)
    {
        if (Vm is not { } vm) return;
        var lista = vm.ResultadosBuscador;
        var i = vm.ResultadoSeleccionado is { } r ? lista.IndexOf(r) : -1;
        switch (e.Key)
        {
            case Key.Escape:
                vm.CerrarBuscadorCommand.Execute(null);
                GridComponentes.Focus();
                break;
            case Key.Enter:
                vm.ElegirInsumoCommand.Execute(null);
                GridComponentes.Focus();
                break;
            case Key.Down when i < lista.Count - 1:
                vm.ResultadoSeleccionado = lista[i + 1];
                ListaBuscador.ScrollIntoView(vm.ResultadoSeleccionado!);
                break;
            case Key.Up when i > 0:
                vm.ResultadoSeleccionado = lista[i - 1];
                ListaBuscador.ScrollIntoView(vm.ResultadoSeleccionado!);
                break;
            default:
                return;
        }
        e.Handled = true;
    }

    private void CerrarAtajos(object? sender, PointerPressedEventArgs e)
    {
        if (Vm is { } vm) vm.AtajosVisibles = false;
    }
}
