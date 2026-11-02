using System.Globalization;
using ObraClara.Apu.Domain.Catalogo;
using ObraClara.Apu.Domain.Presupuestos;

namespace ObraClara.Apu.Application.Reportes;

/// <summary>
/// Para departamentos que todavía reportan en Excel: lee un CSV de avances o de consumos.
/// <code>
///   avances  →  fecha,partida,cantidad,costo_real[,nota]        (obra / compras)
///   consumos →  fecha,insumo,cantidad[,referencia]              (almacén)
/// </code>
/// Cada renglón se valida contra el presupuesto y el catálogo; los errores se reportan por línea.
/// </summary>
public static class ImportadorControl
{
    public sealed record Resultado(List<RegistroAvance> Avances, List<RegistroConsumo> Consumos, List<string> Errores);

    public static Resultado Leer(string texto, Presupuesto presupuesto, CatalogoInsumos catalogo, Departamento? departamento = null)
    {
        var (enc, filas) = Csv.Leer(texto);
        var r = new Resultado([], [], []);
        int Col(string nombre) => Array.IndexOf(enc, nombre);
        var (iFecha, iPartida, iInsumo, iCant, iCosto) = (Col("fecha"), Col("partida"), Col("insumo"), Col("cantidad"), Col("costo_real"));
        var esAvance = iPartida >= 0;
        if (iFecha < 0 || iCant < 0 || (iPartida < 0 && iInsumo < 0))
        {
            r.Errores.Add("Encabezados esperados: fecha,partida,cantidad,costo_real  ó  fecha,insumo,cantidad,referencia");
            return r;
        }
        var partidas = presupuesto.Conceptos.ToDictionary(p => p.Clave, StringComparer.OrdinalIgnoreCase);
        var inv = CultureInfo.InvariantCulture;

        for (var n = 0; n < filas.Count; n++)
        {
            var f = filas[n];
            string Valor(int i) => i >= 0 && i < f.Length ? f[i] : "";
            var linea = n + 2;
            if (!DateOnly.TryParse(Valor(iFecha), inv, out var fecha))
            {
                r.Errores.Add($"Línea {linea}: fecha inválida «{Valor(iFecha)}» (use AAAA-MM-DD)");
                continue;
            }
            if (!decimal.TryParse(Valor(iCant), NumberStyles.Number, inv, out var cantidad) || cantidad < 0)
            {
                r.Errores.Add($"Línea {linea}: cantidad inválida «{Valor(iCant)}»");
                continue;
            }
            if (esAvance)
            {
                if (!partidas.TryGetValue(Valor(iPartida), out var partida))
                {
                    r.Errores.Add($"Línea {linea}: la partida «{Valor(iPartida)}» no es un concepto del presupuesto");
                    continue;
                }
                var costo = 0m;
                if (iCosto >= 0 && Valor(iCosto).Length > 0 && !decimal.TryParse(Valor(iCosto), NumberStyles.Number, inv, out costo))
                {
                    r.Errores.Add($"Línea {linea}: costo inválido «{Valor(iCosto)}»");
                    continue;
                }
                if (cantidad == 0 && costo == 0) continue;
                r.Avances.Add(new RegistroAvance(fecha, partida.Id, cantidad, costo, departamento ?? Departamento.Obra, Valor(Col("nota")) is { Length: > 0 } nota ? nota : null));
            }
            else
            {
                var insumo = catalogo.PorClave(Valor(iInsumo));
                if (insumo is not { Tipo: TipoInsumo.MAT })
                {
                    r.Errores.Add($"Línea {linea}: «{Valor(iInsumo)}» no es un material del catálogo");
                    continue;
                }
                if (cantidad == 0) continue;
                r.Consumos.Add(new RegistroConsumo(fecha, insumo.Id, cantidad, departamento ?? Departamento.Almacen,
                    Valor(Col("referencia")) is { Length: > 0 } refe ? refe : null));
            }
        }
        return r;
    }
}
