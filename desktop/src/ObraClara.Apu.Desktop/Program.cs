using Avalonia;

namespace ObraClara.Apu.Desktop;

internal static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        var i = Array.IndexOf(args, "--sql");
        if (i >= 0 && i + 1 < args.Length) App.CadenaConexion = args[i + 1];
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>().UsePlatformDetect().WithInterFont().LogToTrace();
}
