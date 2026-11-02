using ObraClara.Apu.Domain.Analisis;

namespace ObraClara.Apu.Desktop.ViewModels;

/// <summary>Barra horizontal del tablero (ancho en píxeles ya calculado para la vista).</summary>
public sealed record BarraTablero(string Clave, string Descripcion, decimal Valor, double AnchoPx, bool Negativa, string Detalle);

/// <summary>Formatos que se pueden descargar.</summary>
public enum TipoExportacion { ReportePdf, PresupuestoCsv, ExplosionCsv, AnalisisCsv, DesperdicioCsv }

public static class Tablero
{
    public const double AnchoMaximo = 240;

    public static IEnumerable<BarraTablero> GananciasPerdidas(ResultadoAnalisis a)
    {
        var max = Math.Max(1m, a.Conceptos.Select(c => Math.Abs(c.Variacion)).DefaultIfEmpty(0).Max());
        return a.Conceptos.OrderBy(c => c.Variacion).Select(c => new BarraTablero(c.Clave, c.Descripcion, c.Variacion,
            (double)(Math.Abs(c.Variacion) / max) * AnchoMaximo, c.Variacion < 0,
            $"avance {c.PctAvance:P0} · CPI {(c.Cpi is { } cpi ? cpi.ToString("N3") : "—")}"));
    }

    public static IEnumerable<BarraTablero> Desperdicio(ResultadoAnalisis a)
    {
        var max = Math.Max(1m, a.Desperdicio.Select(d => Math.Abs(d.ImporteExcedente)).DefaultIfEmpty(0).Max());
        return a.Desperdicio.Select(d => new BarraTablero(d.Clave, d.Descripcion, d.ImporteExcedente,
            (double)(Math.Abs(d.ImporteExcedente) / max) * AnchoMaximo, d.Excedente > 0,
            $"real {d.PctDesperdicioReal:P1} vs permitido {d.PctMermaPermitida:P1}"));
    }
}
