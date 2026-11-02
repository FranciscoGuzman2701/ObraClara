using System.Globalization;
using ObraClara.Apu.Domain.Analisis;
using ObraClara.Apu.Domain.Catalogo;
using ObraClara.Apu.Domain.Presupuestos;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace ObraClara.Apu.Infrastructure.Reportes;

/// <summary>
/// Reporte PDF de la obra: presupuesto, explosión de insumos y análisis (dónde gana y pierde,
/// alcance y desperdicio). Usa QuestPDF con licencia Community, gratuita para empresas con
/// ingresos anuales menores a 1 millón de USD; arriba de eso requiere licencia comercial.
/// </summary>
public static class ReportePdf
{
    private const string Marca = "#17375E";
    private const string MarcaClara = "#2E5C8A";
    private const string Acento = "#F2A900";
    private const string Alterno = "#F2F6FA";
    private const string Rojo = "#B42318";
    private const string Verde = "#1E7B45";
    private static readonly CultureInfo Mx = new("es-MX");

    public sealed record Datos(Presupuesto Presupuesto, CatalogoInsumos Catalogo, ResultadoPresupuesto Importes,
        ResultadoExplosion Explosion, ResultadoAnalisis? Analisis, DateTime Fecha);

    static ReportePdf() => QuestPDF.Settings.License = LicenseType.Community;

    public static byte[] Generar(Datos d) => Document.Create(doc =>
    {
        doc.Page(p =>
        {
            p.Size(PageSizes.Letter);
            p.Margin(36);
            p.DefaultTextStyle(t => t.FontSize(9).FontColor("#1B2733"));
            p.Header().Element(c => Encabezado(c, d));
            p.Content().PaddingTop(10).Column(col =>
            {
                col.Spacing(14);
                if (d.Analisis is { } a)
                {
                    col.Item().Element(c => Indicadores(c, a));
                    col.Item().Element(c => GananciasPerdidas(c, a));
                    col.Item().Element(c => Desperdicio(c, a));
                }
                col.Item().Element(c => TablaPresupuesto(c, d));
                col.Item().Element(c => TablaExplosion(c, d.Explosion));
            });
            p.Footer().AlignRight().Text(t =>
            {
                t.Span("ObraClara Precios Unitarios · página ").FontSize(8).FontColor(Colors.Grey.Darken1);
                t.CurrentPageNumber().FontSize(8);
                t.Span(" de ").FontSize(8).FontColor(Colors.Grey.Darken1);
                t.TotalPages().FontSize(8);
            });
        });
    }).GeneratePdf();

    private static string D(decimal v) => v.ToString("C2", Mx);
    private static string N(decimal v, int dec = 2) => v.ToString("N" + dec, Mx);
    private static string P(decimal v) => v.ToString("P1", Mx);

    private static void Encabezado(IContainer c, Datos d) => c.Background(Marca).Padding(10).Row(r =>
    {
        r.ConstantItem(26).Height(26).Background(Acento).AlignCenter().AlignMiddle().Text("OC").Bold().FontColor(Marca);
        r.RelativeItem().PaddingLeft(8).Column(col =>
        {
            col.Item().Text($"{d.Presupuesto.Clave} · {d.Presupuesto.Nombre}").FontSize(13).Bold().FontColor(Colors.White);
            col.Item().Text($"Reporte de obra · {d.Fecha.ToString("d 'de' MMMM 'de' yyyy", Mx)}").FontColor("#C9D8EA");
        });
        r.ConstantItem(170).AlignRight().AlignMiddle().Text(t =>
        {
            t.Span("Total sin IVA  ").FontColor("#C9D8EA");
            t.Span(D(d.Importes.Total)).FontSize(13).Bold().FontColor(Acento);
        });
    });

    private static void Indicadores(IContainer c, ResultadoAnalisis a) => c.Column(col =>
    {
        col.Item().Element(Titulo).Text("Resumen de la obra");
        col.Item().PaddingTop(4).Row(r =>
        {
            void Tarjeta(string etiqueta, string valor, string color)
            {
                r.RelativeItem().Border(1).BorderColor("#C9D4E0").Padding(6).Column(k =>
                {
                    k.Item().Text(etiqueta).FontSize(7.5f).FontColor(Colors.Grey.Darken2);
                    k.Item().Text(valor).FontSize(12).Bold().FontColor(color);
                });
                r.ConstantItem(6);
            }
            Tarjeta("Avance físico", P(a.PctAvance), Marca);
            Tarjeta("CPI (eficiencia de costo)", a.Cpi is { } cpi ? N(cpi, 3) : "—", a.Cpi < 1 ? Rojo : Verde);
            Tarjeta("Margen presupuestado", D(a.MargenPresupuestado), Marca);
            Tarjeta("Margen proyectado al terminar", D(a.MargenProyectado), a.Variacion < 0 ? Rojo : Verde);
            Tarjeta("Fuera de alcance", D(a.ImporteFueraDeAlcance), a.ImporteFueraDeAlcance > 0 ? Rojo : Marca);
            Tarjeta("Desperdicio no previsto", D(a.ImporteDesperdicio), a.ImporteDesperdicio > 0 ? Rojo : Verde);
        });
        col.Item().PaddingTop(4).Text(
            "Margen sobre costo directo (antes de indirectos de oficina). La proyección supone que el resto de cada concepto " +
            "se ejecuta con la misma eficiencia de costo observada hasta hoy.").FontSize(7.5f).FontColor(Colors.Grey.Darken1);
    });

    private static void GananciasPerdidas(IContainer c, ResultadoAnalisis a) => c.Column(col =>
    {
        col.Item().Element(Titulo).Text("Dónde gana y dónde pierde (variación del margen por concepto)");
        var maximo = Math.Max(1, a.Conceptos.Max(x => Math.Abs(x.Variacion)));
        col.Item().Table(t =>
        {
            t.ColumnsDefinition(cd => { cd.ConstantColumn(52); cd.RelativeColumn(3); cd.ConstantColumn(48); cd.ConstantColumn(42); cd.RelativeColumn(2); cd.ConstantColumn(70); });
            t.Header(h =>
            {
                foreach (var e in new[] { "Partida", "Concepto", "Avance", "CPI", "", "Variación" }) h.Cell().Element(Encab).Text(e);
            });
            var i = 0;
            foreach (var x in a.Conceptos.OrderBy(x => x.Variacion))
            {
                var fondo = i++ % 2 == 1 ? Alterno : "#FFFFFF";
                IContainer Celda(IContainer k) => k.Background(fondo).PaddingVertical(3).PaddingHorizontal(4);
                t.Cell().Element(Celda).Text(x.Clave);
                t.Cell().Element(Celda).Text(x.Descripcion);
                t.Cell().Element(Celda).AlignRight().Text(P(x.PctAvance));
                t.Cell().Element(Celda).AlignRight().Text(x.Cpi is { } cpi ? N(cpi, 3) : "—");
                t.Cell().Element(Celda).AlignMiddle().Row(r =>
                {
                    var ancho = (float)(Math.Abs(x.Variacion) / maximo);
                    if (ancho > 0.001f) r.RelativeItem(ancho).Height(8).Background(x.Variacion < 0 ? Rojo : Verde);
                    if (ancho < 0.999f) r.RelativeItem(1 - ancho);
                });
                t.Cell().Element(Celda).AlignRight().Text(D(x.Variacion)).Bold().FontColor(x.Variacion < 0 ? Rojo : Verde);
            }
        });
    });

    private static void Desperdicio(IContainer c, ResultadoAnalisis a) => c.Column(col =>
    {
        col.Item().Element(Titulo).Text("Desperdicio de material (consumo real contra lo que justifica el avance)");
        col.Item().Table(t =>
        {
            t.ColumnsDefinition(cd => { cd.ConstantColumn(60); cd.RelativeColumn(3); cd.ConstantColumn(34); cd.RelativeColumn(); cd.RelativeColumn(); cd.RelativeColumn(); cd.ConstantColumn(56); cd.ConstantColumn(66); });
            t.Header(h =>
            {
                foreach (var e in new[] { "Clave", "Material", "Ud.", "Teórico", "Permitido", "Real", "% desp.", "Excedente $" })
                    h.Cell().Element(Encab).Text(e);
            });
            var i = 0;
            foreach (var d in a.Desperdicio)
            {
                var fondo = i++ % 2 == 1 ? Alterno : "#FFFFFF";
                IContainer Celda(IContainer k) => k.Background(fondo).PaddingVertical(3).PaddingHorizontal(4);
                t.Cell().Element(Celda).Text(d.Clave);
                t.Cell().Element(Celda).Text(d.Descripcion);
                t.Cell().Element(Celda).Text(d.Unidad);
                t.Cell().Element(Celda).AlignRight().Text(N(d.TeoricoSinMerma, 3));
                t.Cell().Element(Celda).AlignRight().Text(N(d.PermitidoConMerma, 3));
                t.Cell().Element(Celda).AlignRight().Text(N(d.Real, 3));
                t.Cell().Element(Celda).AlignRight().Text(d.PctDesperdicioReal is { } p ? P(p) : "—");
                t.Cell().Element(Celda).AlignRight().Text(D(d.ImporteExcedente)).Bold().FontColor(d.Excedente > 0 ? Rojo : Verde);
            }
        });
    });

    private static void TablaPresupuesto(IContainer c, Datos d) => c.Column(col =>
    {
        col.Item().Element(Titulo).Text("Presupuesto");
        col.Item().Table(t =>
        {
            t.ColumnsDefinition(cd => { cd.ConstantColumn(56); cd.RelativeColumn(4); cd.ConstantColumn(34); cd.ConstantColumn(56); cd.ConstantColumn(62); cd.ConstantColumn(78); });
            t.Header(h =>
            {
                foreach (var e in new[] { "Clave", "Descripción", "Ud.", "Cantidad", "P.U.", "Importe" }) h.Cell().Element(Encab).Text(e);
            });
            var i = 0;
            void Agregar(int? padre, int nivel)
            {
                foreach (var p in d.Presupuesto.Hijas(padre))
                {
                    var imp = d.Importes.Partidas[p.Id];
                    var ins = p.InsumoId is { } id ? d.Catalogo[id] : null;
                    var titulo = ins is null;
                    var fondo = titulo ? "#E4ECF5" : i++ % 2 == 1 ? Alterno : "#FFFFFF";
                    IContainer Celda(IContainer k) => k.Background(fondo).PaddingVertical(3).PaddingHorizontal(4);
                    t.Cell().Element(Celda).Text(p.Clave);
                    t.Cell().Element(Celda).PaddingLeft(nivel * 10).Text(t2 =>
                    {
                        var s = t2.Span(ins?.Descripcion ?? p.Descripcion);
                        if (titulo) s.Bold();
                    });
                    t.Cell().Element(Celda).Text(ins?.Unidad ?? "");
                    t.Cell().Element(Celda).AlignRight().Text(titulo ? "" : N(p.Cantidad));
                    t.Cell().Element(Celda).AlignRight().Text(titulo ? "" : N(imp.PrecioUnitario));
                    t.Cell().Element(Celda).AlignRight().Text(t2 =>
                    {
                        var s = t2.Span(N(imp.Importe));
                        if (titulo) s.Bold();
                    });
                    Agregar(p.Id, nivel + 1);
                }
            }
            Agregar(null, 0);
            t.Cell().ColumnSpan(5).Background(Marca).Padding(4).AlignRight().Text("Total sin IVA").Bold().FontColor(Colors.White);
            t.Cell().Background(Marca).Padding(4).AlignRight().Text(D(d.Importes.Total)).Bold().FontColor(Acento);
        });
    });

    private static void TablaExplosion(IContainer c, ResultadoExplosion e) => c.Column(col =>
    {
        col.Item().Element(Titulo).Text("Explosión de insumos");
        col.Item().Table(t =>
        {
            t.ColumnsDefinition(cd => { cd.ConstantColumn(34); cd.ConstantColumn(62); cd.RelativeColumn(4); cd.ConstantColumn(34); cd.ConstantColumn(70); cd.ConstantColumn(62); cd.ConstantColumn(78); });
            t.Header(h =>
            {
                foreach (var x in new[] { "Tipo", "Clave", "Descripción", "Ud.", "Cantidad", "Costo", "Importe" }) h.Cell().Element(Encab).Text(x);
            });
            var i = 0;
            foreach (var x in e.Insumos)
            {
                var fondo = i++ % 2 == 1 ? Alterno : "#FFFFFF";
                IContainer Celda(IContainer k) => k.Background(fondo).PaddingVertical(3).PaddingHorizontal(4);
                t.Cell().Element(Celda).Text(x.Tipo.ToString()).Bold().FontColor(ColorTipo(x.Tipo));
                t.Cell().Element(Celda).Text(x.Clave);
                t.Cell().Element(Celda).Text(x.Descripcion);
                t.Cell().Element(Celda).Text(x.Unidad);
                t.Cell().Element(Celda).AlignRight().Text(N(x.Cantidad, 3));
                t.Cell().Element(Celda).AlignRight().Text(N(x.CostoUnitario));
                t.Cell().Element(Celda).AlignRight().Text(N(x.Importe));
            }
            t.Cell().ColumnSpan(6).Padding(4).AlignRight().Text("Herramienta menor y equipo de seguridad").FontColor(Colors.Grey.Darken2);
            t.Cell().Padding(4).AlignRight().Text(N(e.Herramienta + e.EquipoSeguridad));
            t.Cell().ColumnSpan(6).Background(Marca).Padding(4).AlignRight().Text("Costo directo de la obra").Bold().FontColor(Colors.White);
            t.Cell().Background(Marca).Padding(4).AlignRight().Text(D(e.CostoDirectoTotal)).Bold().FontColor(Acento);
        });
    });

    private static string ColorTipo(TipoInsumo t) => t switch
    {
        TipoInsumo.MAT => "#1F6FB2", TipoInsumo.MO => "#2E7D4F", TipoInsumo.EQ => "#B85C00", TipoInsumo.BAS => "#6B3FA0", _ => Marca,
    };

    private static IContainer Titulo(IContainer c) =>
        c.BorderBottom(2).BorderColor(Acento).PaddingBottom(2).DefaultTextStyle(t => t.FontSize(11).Bold().FontColor(Marca));

    private static IContainer Encab(IContainer c) =>
        c.Background(MarcaClara).PaddingVertical(4).PaddingHorizontal(4).DefaultTextStyle(t => t.Bold().FontColor(Colors.White).FontSize(8));
}
