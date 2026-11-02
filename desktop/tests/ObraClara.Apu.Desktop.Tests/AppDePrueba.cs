using Avalonia;
using Avalonia.Headless;
using ObraClara.Apu.Desktop;

[assembly: AvaloniaTestApplication(typeof(ObraClara.Apu.Desktop.Tests.AppDePrueba))]

namespace ObraClara.Apu.Desktop.Tests;

/// <summary>La aplicación real (estilos, DataGrid) sobre la plataforma sin pantalla, con Skia para poder capturar imágenes.</summary>
public static class AppDePrueba
{
    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UseSkia()
            .WithInterFont()
            .UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false });
}
