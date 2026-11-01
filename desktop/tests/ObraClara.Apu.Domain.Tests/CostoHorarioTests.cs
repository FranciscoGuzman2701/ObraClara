using ObraClara.Apu.Domain;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Domain.Tests;

public class CostoHorarioTests
{
    private static readonly ParametrosCostoHorario Maquina = new()
    {
        PrecioAdquisicion = 1_000_000m, ValorLlantas = 50_000m, VidaLlantasHoras = 2_000m,
        TasaValorRescate = 0.20m, VidaEconomicaHoras = 10_000m, HorasEfectivasAnio = 2_000m,
        TasaInteresAnual = 0.12m, TasaSeguroAnual = 0.03m, CoeficienteMantenimiento = 0.8m,
        PotenciaHp = 100m, FactorOperacion = 0.7m, CoeficienteCombustible = 0.1514m, CombustibleInsumoId = 1,
        CapacidadCarterLitros = 20m, HorasEntreCambios = 200m, ConsumoAceiteHora = 0.05m, LubricanteInsumoId = 2,
        OperadorInsumoId = 3, HorasEfectivasTurno = 8m,
    };

    private static decimal Precio(int id) => id switch { 1 => 25m, 2 => 120m, 3 => 800m, _ => throw new InvalidOperationException() };

    [Fact]
    public void Calcula_cada_cargo_verificado_a_mano()
    {
        var r = CalculadoraCostoHorario.Calcular(Maquina, Precio);

        Assert.Equal(950_000m, r.ValorMaquina);      // 1,000,000 − 50,000 de llantas
        Assert.Equal(190_000m, r.ValorRescate);
        Assert.Equal(76m, r.Depreciacion);           // 760,000 / 10,000
        Assert.Equal(34.2m, r.Inversion);            // 1,140,000 / 4,000 × 0.12
        Assert.Equal(8.55m, r.Seguros);              // 285 × 0.03
        Assert.Equal(60.8m, r.Mantenimiento);        // 0.8 × 76
        Assert.Equal(264.95m, r.Combustible);        // 100 × 0.7 × 0.1514 × 25
        Assert.Equal(18m, r.Lubricantes);            // (0.05 + 20/200) × 120
        Assert.Equal(25m, r.Llantas);                // 50,000 / 2,000
        Assert.Equal(100m, r.Operacion);             // 800 / 8
        Assert.Equal(179.55m, r.CargosFijos);
        Assert.Equal(587.50m, r.CostoHorario);
    }

    [Fact]
    public void Valida_datos_de_la_maquina()
    {
        Assert.Throws<ReglaDeNegocioException>(() => CalculadoraCostoHorario.Calcular(Maquina with { VidaEconomicaHoras = 0 }, Precio));
        Assert.Throws<ReglaDeNegocioException>(() => CalculadoraCostoHorario.Calcular(Maquina with { VidaLlantasHoras = 0 }, Precio));
        Assert.Throws<ReglaDeNegocioException>(() => CalculadoraCostoHorario.Calcular(Maquina with { TasaValorRescate = 1 }, Precio));
    }
}
