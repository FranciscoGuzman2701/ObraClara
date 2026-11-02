using System.Globalization;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using ObraClara.Apu.Application;
using ObraClara.Apu.Desktop.ViewModels;
using ObraClara.Apu.Desktop.Views;
using ObraClara.Apu.Infrastructure;

namespace ObraClara.Apu.Desktop;

public partial class App : Avalonia.Application
{
    /// <summary>Cadena de conexión a SQL Server; sin ella se abre el catálogo de ejemplo en memoria.</summary>
    public static string? CadenaConexion { get; set; } = Environment.GetEnvironmentVariable("OBRACLARA_PU_SQLSERVER");

    public override void Initialize()
    {
        // números y moneda en formato mexicano ($1,234.56) en todos los hilos, incluida la interfaz
        var mx = new CultureInfo("es-MX");
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.DefaultThreadCurrentUICulture = mx;
        CultureInfo.CurrentCulture = CultureInfo.CurrentUICulture = mx;
        AvaloniaXamlLoader.Load(this);
    }

    public override async void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime escritorio)
        {
            var vm = await CrearViewModelAsync(CadenaConexion);
            escritorio.MainWindow = new MainWindow { DataContext = vm };
            escritorio.MainWindow.Show();
        }
        base.OnFrameworkInitializationCompleted();
    }

    public static async Task<MainWindowViewModel> CrearViewModelAsync(string? cadena)
    {
        if (string.IsNullOrWhiteSpace(cadena))
        {
            var catalogo = CatalogoDemo.Crear();
            return new MainWindowViewModel(SesionCatalogo.EnMemoria(catalogo, CatalogoDemo.CrearPresupuesto(catalogo), CatalogoDemo.CrearControl()),
                "catálogo de ejemplo (sin base de datos)");
        }
        var sesion = await SesionCatalogo.AbrirAsync(new RepositorioSqlServer(cadena), presupuestoId: 1);
        return new MainWindowViewModel(sesion, "SQL Server");
    }
}
