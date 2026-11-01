using ObraClara.Apu.Domain.Catalogo;

namespace ObraClara.Apu.Domain.Calculo;

/// <summary>Costo horario desglosado por cargo, en $/hora efectiva.</summary>
public sealed record ResultadoCostoHorario(
    decimal ValorMaquina,          // Vm = Va − Pn − Pa
    decimal ValorRescate,          // Vr = Vm · r
    decimal Depreciacion,          // D  = (Vm − Vr) / Ve
    decimal Inversion,             // Im = (Vm + Vr) / (2·Hea) · i
    decimal Seguros,               // Sm = (Vm + Vr) / (2·Hea) · s
    decimal Mantenimiento,         // Mn = Ko · D
    decimal Combustible,           // Co = Gh · Pc,  Gh = HP · Fo · coef
    decimal Lubricantes,           // Lb = (Ah + Ga) · Pa,  Ga = C / t
    decimal Llantas,               // N  = Pn / Vn
    decimal PiezasEspeciales,      // Ae = Pa / Va
    decimal Operacion)             // Po = Sr / Ht
{
    public decimal CargosFijos => Depreciacion + Inversion + Seguros + Mantenimiento;
    public decimal Consumos => Combustible + Lubricantes + Llantas + PiezasEspeciales;
    public decimal CostoHorario => CargosFijos + Consumos + Operacion;
}

public static class CalculadoraCostoHorario
{
    /// <param name="costoDe">Costo unitario vigente de otro insumo (combustible, aceite, operador).</param>
    public static ResultadoCostoHorario Calcular(ParametrosCostoHorario p, Func<int, decimal> costoDe)
    {
        p.Validar();
        var vm = p.PrecioAdquisicion - p.ValorLlantas - p.ValorPiezasEspeciales;
        var vr = vm * p.TasaValorRescate;
        var d = (vm - vr) / p.VidaEconomicaHoras;
        var mitadInversionPorHora = (vm + vr) / (2m * p.HorasEfectivasAnio);
        var im = mitadInversionPorHora * p.TasaInteresAnual;
        var sm = mitadInversionPorHora * p.TasaSeguroAnual;
        var mn = p.CoeficienteMantenimiento * d;

        var co = p.CombustibleInsumoId is { } comb
            ? p.PotenciaHp * p.FactorOperacion * p.CoeficienteCombustible * costoDe(comb)
            : 0m;
        var ga = p.HorasEntreCambios > 0 ? p.CapacidadCarterLitros / p.HorasEntreCambios : 0m;
        var lb = p.LubricanteInsumoId is { } lub ? (p.ConsumoAceiteHora + ga) * costoDe(lub) : 0m;
        var n = p.ValorLlantas > 0 ? p.ValorLlantas / p.VidaLlantasHoras : 0m;
        var ae = p.ValorPiezasEspeciales > 0 ? p.ValorPiezasEspeciales / p.VidaPiezasHoras : 0m;
        var po = p.OperadorInsumoId is { } op ? costoDe(op) / p.HorasEfectivasTurno : 0m;

        return new ResultadoCostoHorario(vm, vr, d, im, sm, mn, co, lb, n, ae, po);
    }
}
