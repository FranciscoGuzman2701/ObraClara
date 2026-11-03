using System.Globalization;
using System.Text.RegularExpressions;
using ObraClara.Apu.Domain.Contabilidad;

namespace ObraClara.Apu.Application.Contabilidad;

/// <summary>
/// Importa catálogos desde las filas de una hoja (Excel o CSV) sin depender de encabezados:
/// reconoce cada columna por su contenido, como aparecen en los catálogos exportados de un ERP
/// (clave 501-01-001, "G Resultados Deudora", "Afectable", código agrupador 501.01…).
/// </summary>
public static partial class ImportadorContable
{
    [GeneratedRegex(@"^\d{3}(-\d{2,3}){0,3}$")] private static partial Regex ClaveCuenta();
    [GeneratedRegex(@"^\d+(-\d+)*$")] private static partial Regex ClaveUnidad();
    [GeneratedRegex(@"^\d{3}(\.\d{2})?$")] private static partial Regex Agrupador();

    public sealed record Resultado<T>(List<T> Registros, List<string> Errores);

    /// <param name="prefijosConProyecto">Géneros cuyas cuentas afectables exigen proyecto (costos y gastos).</param>
    public static Resultado<CuentaContable> Cuentas(IEnumerable<string[]> filas, params string[] prefijosConProyecto)
    {
        prefijosConProyecto = prefijosConProyecto.Length > 0 ? prefijosConProyecto : ["5", "6"];
        var r = new Resultado<CuentaContable>([], []);
        var vistas = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var (fila, n) in filas.Select((f, i) => (f.Select(c => c?.Trim() ?? "").ToArray(), i + 1)))
        {
            var iClave = Array.FindIndex(fila, c => ClaveCuenta().IsMatch(c));
            if (iClave < 0) continue;                                              // encabezados, totales, filas vacías
            var clave = fila[iClave];
            var nombre = fila.Skip(iClave + 1).FirstOrDefault(c => c.Length > 0 && !ClaveCuenta().IsMatch(c)) ?? "";
            if (nombre.Length == 0) { r.Errores.Add($"Fila {n}: la cuenta {clave} no tiene nombre"); continue; }
            var texto = string.Join(' ', fila).ToLowerInvariant();
            var naturaleza = texto.Contains("acreedor") ? Naturaleza.Acreedora
                : texto.Contains("deudor") ? Naturaleza.Deudora
                : clave[0] is '2' or '3' or '4' ? Naturaleza.Acreedora : Naturaleza.Deudora;
            var afectable = fila.Any(c => c.Equals("afectable", StringComparison.OrdinalIgnoreCase) || c.Equals("sí afectable", StringComparison.OrdinalIgnoreCase));
            var agrupador = fila.Skip(iClave + 1).LastOrDefault(c => Agrupador().IsMatch(c));
            var conProyecto = afectable && prefijosConProyecto.Any(p => clave.StartsWith(p, StringComparison.Ordinal));
            var cuenta = new CuentaContable(clave, nombre, naturaleza, afectable, agrupador, conProyecto);
            if (vistas.TryGetValue(clave, out var i)) r.Registros[i] = cuenta;               // la última versión gana
            else { vistas[clave] = r.Registros.Count; r.Registros.Add(cuenta); }
        }
        if (r.Registros.Count == 0) r.Errores.Add("No se encontró ninguna cuenta con clave tipo 501-01-001");
        return r;
    }

    public static Resultado<UnidadNegocio> Unidades(IEnumerable<string[]> filas)
    {
        var r = new Resultado<UnidadNegocio>([], []);
        foreach (var (fila, n) in filas.Select((f, i) => (f.Select(c => c?.Trim() ?? "").ToArray(), i + 1)))
        {
            var iClave = Array.FindIndex(fila, c => ClaveUnidad().IsMatch(c));
            if (iClave < 0) continue;
            var descripcion = fila.Skip(iClave + 1).FirstOrDefault(c => c.Length > 0);
            if (descripcion is null) { r.Errores.Add($"Fila {n}: la unidad {fila[iClave]} no tiene descripción"); continue; }
            r.Registros.Add(new UnidadNegocio(fila[iClave], descripcion));
        }
        // padres antes que hijas, para que el libro valide la jerarquía
        r.Registros.Sort((a, b) => a.Nivel.CompareTo(b.Nivel));
        if (r.Registros.Count == 0) r.Errores.Add("No se encontró ninguna unidad con clave tipo 100-001-002");
        return r;
    }

    /// <summary>
    /// Movimientos en CSV: fecha,poliza,cuenta,proyecto,cargo,abono[,concepto][,partida].
    /// Los renglones con el mismo folio forman una póliza; se valida cada una completa.
    /// </summary>
    public static Resultado<Poliza> Polizas(string csv, LibroContable libro)
    {
        var (enc, filas) = Reportes.Csv.Leer(csv);
        var r = new Resultado<Poliza>([], []);
        int Col(string nombre) => Array.IndexOf(enc, nombre);
        var (iF, iP, iC, iPr, iCa, iAb, iCo, iPa) = (Col("fecha"), Col("poliza"), Col("cuenta"), Col("proyecto"), Col("cargo"), Col("abono"), Col("concepto"), Col("partida"));
        if (iF < 0 || iP < 0 || iC < 0 || iCa < 0 || iAb < 0)
        {
            r.Errores.Add("Encabezados esperados: fecha,poliza,cuenta,proyecto,cargo,abono,concepto,partida");
            return r;
        }
        var inv = CultureInfo.InvariantCulture;
        var grupos = new Dictionary<string, (DateOnly Fecha, List<Movimiento> Movs)>();
        for (var n = 0; n < filas.Count; n++)
        {
            var f = filas[n];
            string V(int i) => i >= 0 && i < f.Length ? f[i] : "";
            decimal Num(int i) => V(i).Length == 0 ? 0 : decimal.Parse(V(i), NumberStyles.Number, inv);
            try
            {
                var fecha = DateOnly.Parse(V(iF), inv);
                var folio = V(iP);
                if (!grupos.TryGetValue(folio, out var g)) grupos[folio] = g = (fecha, []);
                g.Movs.Add(new Movimiento(V(iC), V(iPr) is { Length: > 0 } pr ? pr : null, Num(iCa), Num(iAb),
                    V(iPa) is { Length: > 0 } pa ? pa : null, V(iCo) is { Length: > 0 } co ? co : null));
            }
            catch (FormatException)
            {
                r.Errores.Add($"Línea {n + 2}: fecha o importe inválido");
            }
        }
        foreach (var (folio, g) in grupos)
        {
            var poliza = new Poliza(folio, g.Fecha, g.Movs.FirstOrDefault(m => m.Concepto is not null)?.Concepto ?? folio, g.Movs, "CSV");
            try
            {
                libro.Validar(poliza);
                r.Registros.Add(poliza);
            }
            catch (Domain.ReglaDeNegocioException ex)
            {
                r.Errores.Add(ex.Message);
            }
        }
        return r;
    }
}
