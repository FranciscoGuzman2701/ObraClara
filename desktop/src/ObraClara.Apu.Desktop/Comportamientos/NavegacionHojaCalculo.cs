using System.Runtime.CompilerServices;
using System.Windows.Input;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace ObraClara.Apu.Desktop.Comportamientos;

/// <summary>
/// Navegación tipo hoja de cálculo para un DataGrid:
/// <list type="bullet">
///   <item>Escribir sobre una celda editable empieza a editarla con lo tecleado (sin F2 ni doble clic).</item>
///   <item>Enter confirma y baja; Shift+Enter sube. En el último renglón ejecuta <c>ComandoNuevoRenglon</c>.</item>
///   <item>Tab / Shift+Tab confirman y avanzan entre columnas editables, pasando de renglón al llegar al borde.</item>
///   <item>↑ ↓ durante la edición confirman y se mueven, como en Excel.</item>
///   <item>Supr (sin editar) ejecuta <c>ComandoEliminar</c> con el renglón actual; Esc cancela la edición.</item>
/// </list>
/// Se engancha con eventos de túnel para decidir antes que el editor de la celda.
/// </summary>
public static class NavegacionHojaCalculo
{
    public static readonly AttachedProperty<bool> HabilitarProperty =
        AvaloniaProperty.RegisterAttached<DataGrid, bool>("Habilitar", typeof(NavegacionHojaCalculo));
    public static readonly AttachedProperty<ICommand?> ComandoNuevoRenglonProperty =
        AvaloniaProperty.RegisterAttached<DataGrid, ICommand?>("ComandoNuevoRenglon", typeof(NavegacionHojaCalculo));
    public static readonly AttachedProperty<ICommand?> ComandoEliminarProperty =
        AvaloniaProperty.RegisterAttached<DataGrid, ICommand?>("ComandoEliminar", typeof(NavegacionHojaCalculo));

    private static readonly ConditionalWeakTable<DataGrid, StrongBox<bool>> Editando = new();

    public static bool GetHabilitar(DataGrid g) => g.GetValue(HabilitarProperty);
    public static void SetHabilitar(DataGrid g, bool v) => g.SetValue(HabilitarProperty, v);
    public static ICommand? GetComandoNuevoRenglon(DataGrid g) => g.GetValue(ComandoNuevoRenglonProperty);
    public static void SetComandoNuevoRenglon(DataGrid g, ICommand? v) => g.SetValue(ComandoNuevoRenglonProperty, v);
    public static ICommand? GetComandoEliminar(DataGrid g) => g.GetValue(ComandoEliminarProperty);
    public static void SetComandoEliminar(DataGrid g, ICommand? v) => g.SetValue(ComandoEliminarProperty, v);

    static NavegacionHojaCalculo()
    {
        HabilitarProperty.Changed.AddClassHandler<DataGrid>((grid, e) =>
        {
            if (e.NewValue is not true) return;
            var editando = Editando.GetOrCreateValue(grid);
            grid.PreparingCellForEdit += (_, _) => editando.Value = true;
            grid.CellEditEnded += (_, _) => editando.Value = false;
            grid.AddHandler(InputElement.KeyDownEvent, AlPresionarTecla, RoutingStrategies.Tunnel);
            grid.AddHandler(InputElement.TextInputEvent, AlEscribir, RoutingStrategies.Tunnel);
        });
    }

    public static bool EstaEditando(DataGrid grid) => Editando.TryGetValue(grid, out var b) && b.Value;

    private static void AlPresionarTecla(object? sender, KeyEventArgs e)
    {
        if (sender is not DataGrid grid) return;
        var editando = EstaEditando(grid);
        var shift = e.KeyModifiers.HasFlag(KeyModifiers.Shift);
        switch (e.Key)
        {
            case Key.Enter:
                Confirmar(grid);
                MoverRenglon(grid, shift ? -1 : 1);
                e.Handled = true;
                break;
            case Key.Tab:
                Confirmar(grid);
                MoverColumna(grid, shift ? -1 : 1);
                e.Handled = true;
                break;
            case Key.Up or Key.Down when editando:
                Confirmar(grid);
                MoverRenglon(grid, e.Key == Key.Down ? 1 : -1);
                e.Handled = true;
                break;
            case Key.Delete when !editando:
                var eliminar = GetComandoEliminar(grid);
                if (grid.SelectedItem is { } item && eliminar?.CanExecute(item) == true)
                {
                    eliminar.Execute(item);
                    e.Handled = true;
                }
                break;
        }
    }

    /// <summary>Tecla imprimible sobre una celda sin editar: entra a edición y reemplaza el contenido.</summary>
    private static void AlEscribir(object? sender, TextInputEventArgs e)
    {
        if (sender is not DataGrid grid || EstaEditando(grid) || string.IsNullOrEmpty(e.Text) || char.IsControl(e.Text[0])) return;
        if (grid.CurrentColumn is not { IsReadOnly: false } || grid.SelectedItem is null) return;
        if (!grid.BeginEdit()) return;
        var texto = e.Text;
        e.Handled = true;
        Dispatcher.UIThread.Post(() =>
        {
            // el editor de la celda es el único TextBox dentro de la grilla mientras se edita
            var editor = TopLevel.GetTopLevel(grid)?.FocusManager?.GetFocusedElement() as TextBox
                ?? grid.GetVisualDescendants().OfType<TextBox>().FirstOrDefault();
            if (editor is null) return;
            editor.Text = texto;
            editor.CaretIndex = texto.Length;
        }, DispatcherPriority.Input);
    }

    private static void Confirmar(DataGrid grid)
    {
        if (EstaEditando(grid)) grid.CommitEdit();
    }

    public static void MoverRenglon(DataGrid grid, int delta)
    {
        var total = ContarRenglones(grid);
        var destino = grid.SelectedIndex + delta;
        if (destino >= total && delta > 0 && GetComandoNuevoRenglon(grid) is { } nuevo && nuevo.CanExecute(null))
        {
            nuevo.Execute(null);
            total = ContarRenglones(grid);
        }
        if (destino < 0 || destino >= total) return;
        grid.SelectedIndex = destino;
        if (grid.SelectedItem is { } item) grid.ScrollIntoView(item, grid.CurrentColumn);
    }

    public static void MoverColumna(DataGrid grid, int delta)
    {
        var editables = grid.Columns.Where(c => c.IsVisible && !c.IsReadOnly).OrderBy(c => c.DisplayIndex).ToList();
        if (editables.Count == 0) return;
        var i = grid.CurrentColumn is { } actual ? editables.IndexOf(actual) : -1;
        var j = i + delta;
        if (j >= editables.Count) { MoverRenglon(grid, 1); j = 0; }
        else if (j < 0) { MoverRenglon(grid, -1); j = editables.Count - 1; }
        grid.CurrentColumn = editables[j];
        if (grid.SelectedItem is { } item) grid.ScrollIntoView(item, grid.CurrentColumn);
    }

    private static int ContarRenglones(DataGrid grid) => grid.ItemsSource?.Cast<object>().Count() ?? 0;
}
