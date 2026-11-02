using System.Globalization;
using Avalonia.Data.Converters;
using Avalonia.Media;
using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Desktop.Views;

/// <summary>Color de la etiqueta de tipo de insumo (MAT, MO, EQ, BAS, CON), como en los catálogos de PU.</summary>
public sealed class TipoAColor : IValueConverter
{
    public static readonly TipoAColor Instancia = new();

    private static readonly Dictionary<TipoInsumo, IBrush> Colores = new()
    {
        [TipoInsumo.MAT] = new SolidColorBrush(Color.Parse("#1F6FB2")),
        [TipoInsumo.MO] = new SolidColorBrush(Color.Parse("#2E7D4F")),
        [TipoInsumo.EQ] = new SolidColorBrush(Color.Parse("#B85C00")),
        [TipoInsumo.BAS] = new SolidColorBrush(Color.Parse("#6B3FA0")),
        [TipoInsumo.CON] = new SolidColorBrush(Color.Parse("#17375E")),
    };

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is TipoInsumo t ? Colores[t] : Brushes.Black;

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
