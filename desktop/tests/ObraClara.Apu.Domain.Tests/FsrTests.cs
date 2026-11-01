using ObraClara.Apu.Domain;
using ObraClara.Apu.Domain.Calculo;
using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Domain.Tests;

public class FsrTests
{
    // Números redondos para poder verificar a mano.
    private static ParametrosFsr Parametros(params CuotaPatronal[] cuotas) => new()
    {
        Id = 1, Nombre = "prueba", Uma = 100m,
        DiasNoLaborados = [new("Domingos", 52), new("Festivos", 7), new("Vacaciones", 12), new("Clima", 3), new("Costumbre", 2), new("Enfermedad", 2)],
        Cuotas = cuotas,
    };

    [Fact]
    public void Calcula_dias_pagados_laborados_y_fsr_verificado_a_mano()
    {
        var p = Parametros(
            new("SBC 10 %", BaseCuota.SalarioBaseCotizacion, 0.10m),
            new("Cuota fija 20 % UMA", BaseCuota.Uma, 0.20m),
            new("Excedente 3 UMA", BaseCuota.ExcedenteTresUma, 0.011m),
            new("Nómina 3 %", BaseCuota.SalarioPagado, 0.03m));

        var r = CalculadoraFsr.Calcular(100m, p);

        Assert.Equal(383m, r.DiasPagados);              // 365 + 15 + 12 × 0.25
        Assert.Equal(287m, r.DiasLaborados);            // 365 − 78
        Assert.Equal(104.931507m, Math.Round(r.SalarioBaseCotizacion, 6));
        // 0.10·SBC·365 = 3,830 ; 0.20·100·365 = 7,300 ; excedente 0 (SBC < 300) ; 0.03·100·383 = 1,149
        Assert.Equal(12_279m, Math.Round(r.CuotasAnuales, 6));
        Assert.Equal(0.320601m, Math.Round(r.Ps, 6));
        // FSR = (38,300 + 12,279) / (100 · 287)
        Assert.Equal(Math.Round(50_579m / 28_700m, 10), Math.Round(r.Fsr, 10));
        Assert.Equal(176.233449m, Math.Round(r.SalarioReal, 6));
    }

    [Fact]
    public void Formula_reglamentaria_equivale_a_costo_anual_entre_dias_laborados()
    {
        var p = CatalogoDemoParametros();
        foreach (var salario in new[] { 278.80m, 450m, 600m, 1500m, 4000m })
        {
            var r = CalculadoraFsr.Calcular(salario, p);
            var costoAnual = salario * r.DiasPagados + r.CuotasAnuales;
            Assert.Equal(Math.Round(costoAnual / r.DiasLaborados, 8), Math.Round(r.SalarioReal, 8));
            Assert.True(r.Fsr > 1.4m && r.Fsr < 2.2m, $"FSR fuera de rango razonable: {r.Fsr}");
        }
    }

    [Fact]
    public void Topa_el_sbc_en_25_uma_y_cobra_excedente_sobre_3_uma()
    {
        var p = Parametros(new CuotaPatronal("Excedente", BaseCuota.ExcedenteTresUma, 0.011m));
        var r = CalculadoraFsr.Calcular(5_000m, p);
        Assert.Equal(2_500m, r.SalarioBaseCotizacion);
        Assert.Equal(0.011m * (2_500m - 300m) * 365m, r.CuotasAnuales);
    }

    [Fact]
    public void Rechaza_parametros_inconsistentes()
    {
        Assert.Throws<ReglaDeNegocioException>(() => CalculadoraFsr.Calcular(0m, Parametros()));
        var malo = Parametros() with { DiasNoLaborados = [new("Todo el año", 365)] };
        Assert.Throws<ReglaDeNegocioException>(() => CalculadoraFsr.Calcular(100m, malo));
    }

    private static ParametrosFsr CatalogoDemoParametros() => ObraClara.Apu.Application.CatalogoDemo.Fsr2026;
}
