using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace ObraClara.Apu.Infrastructure.Tests;

/// <summary>
/// Crea una base desechable y le aplica db/01..03. Requiere la variable
/// APU_SQLSERVER (cadena de conexión al servidor, sin base); sin ella las pruebas se omiten.
/// </summary>
public sealed class BaseDePrueba : IAsyncLifetime
{
    public const string Variable = "APU_SQLSERVER";
    private readonly string? _servidor = Environment.GetEnvironmentVariable(Variable);
    private readonly string _nombre = $"ObraClaraApu_Prueba_{Guid.NewGuid():N}"[..40];

    public bool Disponible => _servidor is not null;
    public string CadenaConexion => new SqlConnectionStringBuilder(_servidor) { InitialCatalog = _nombre }.ConnectionString;

    public async Task InitializeAsync()
    {
        if (!Disponible) return;
        await EjecutarAsync(_servidor!, $"CREATE DATABASE [{_nombre}] COLLATE Modern_Spanish_CI_AS");
        foreach (var archivo in new[] { "01_esquema.sql", "02_programabilidad.sql", "03_datos_ejemplo.sql" })
            await AplicarScriptAsync(Path.Combine(AppContext.BaseDirectory, "db", archivo));
    }

    public async Task DisposeAsync()
    {
        if (!Disponible) return;
        SqlConnection.ClearAllPools();
        await EjecutarAsync(_servidor!, $"ALTER DATABASE [{_nombre}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_nombre}]");
    }

    /// <summary>Divide en lotes por GO, como sqlcmd.</summary>
    public async Task AplicarScriptAsync(string ruta)
    {
        var texto = await File.ReadAllTextAsync(ruta);
        foreach (var lote in Regex.Split(texto, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
            if (!string.IsNullOrWhiteSpace(lote)) await EjecutarAsync(CadenaConexion, lote);
    }

    public static async Task EjecutarAsync(string cadena, string sql)
    {
        await using var cn = new SqlConnection(cadena);
        await cn.OpenAsync();
        await using var cmd = new SqlCommand(sql, cn) { CommandTimeout = 120 };
        await cmd.ExecuteNonQueryAsync();
    }
}
