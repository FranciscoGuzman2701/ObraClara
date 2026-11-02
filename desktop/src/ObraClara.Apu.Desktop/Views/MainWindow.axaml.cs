using Avalonia.Controls;
using Avalonia.Input;

namespace ObraClara.Apu.Desktop.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        KeyDown += (_, e) =>
        {
            if (e.Key == Key.F && e.KeyModifiers.HasFlag(KeyModifiers.Control))
            {
                Buscar.Focus();
                e.Handled = true;
            }
        };
    }
}
