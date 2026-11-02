using System.Globalization;
using System.Text;

namespace ObraClara.Apu.Application.Reportes;

/// <summary>
/// CSV en UTF-8 con BOM (Excel en español lo abre con acentos correctos), coma como separador
/// y punto decimal sin separador de miles: lo leen igual Excel, Power BI, Python o R.
/// </summary>
public static class Csv
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static string Escribir(IEnumerable<string> encabezados, IEnumerable<IEnumerable<object?>> filas)
    {
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(',', encabezados.Select(Celda)));
        foreach (var fila in filas) sb.AppendLine(string.Join(',', fila.Select(Celda)));
        return sb.ToString();
    }

    public static byte[] ABytes(string csv) => [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(csv)];

    private static string Celda(object? v) => v switch
    {
        null => "",
        decimal d => d.ToString(Inv),
        double d => d.ToString(Inv),
        DateOnly f => f.ToString("yyyy-MM-dd", Inv),
        _ => Entrecomillar(Convert.ToString(v, Inv) ?? ""),
    };

    private static string Entrecomillar(string s) =>
        s.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{s.Replace("\"", "\"\"")}\"" : s;

    /// <summary>Lee un CSV sencillo (comillas dobles opcionales). Devuelve encabezados en minúsculas y filas.</summary>
    public static (string[] Encabezados, List<string[]> Filas) Leer(string texto)
    {
        var lineas = texto.TrimStart('﻿').Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Trim().Length > 0).ToList();
        if (lineas.Count == 0) return ([], []);
        var separador = lineas[0].Count(ch => ch == ';') > lineas[0].Count(ch => ch == ',') ? ';' : ',';
        string[] Partir(string linea)
        {
            var campos = new List<string>();
            var actual = new StringBuilder();
            var comillas = false;
            for (var i = 0; i < linea.Length; i++)
            {
                var ch = linea[i];
                if (comillas)
                {
                    if (ch == '"' && i + 1 < linea.Length && linea[i + 1] == '"') { actual.Append('"'); i++; }
                    else if (ch == '"') comillas = false;
                    else actual.Append(ch);
                }
                else if (ch == '"') comillas = true;
                else if (ch == separador) { campos.Add(actual.ToString().Trim()); actual.Clear(); }
                else actual.Append(ch);
            }
            campos.Add(actual.ToString().Trim());
            return [.. campos];
        }
        return (Partir(lineas[0]).Select(h => h.ToLowerInvariant()).ToArray(), lineas.Skip(1).Select(Partir).ToList());
    }
}
