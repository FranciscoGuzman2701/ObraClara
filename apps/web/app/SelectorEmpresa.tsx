'use client';
import type { EmpresaAcceso } from '@obraclara/contracts';
import { cambiarEmpresa } from './acciones';

/** Cambia la empresa de la sesión: cada empresa tiene su propio registro y roles. */
export function SelectorEmpresa({ empresas }: { empresas: EmpresaAcceso[] }) {
  const actual = empresas.find((e) => e.actual);
  if (empresas.length <= 1) return actual ? <span className="chip empresa">{actual.clave ?? actual.nombre}</span> : null;
  return (
    <form action={cambiarEmpresa} className="acciones">
      <label className="oculto" htmlFor="empresa_id">Empresa</label>
      <select
        id="empresa_id" name="empresa_id" defaultValue={actual?.id} className="selector-empresa"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {empresas.map((e) => <option key={e.id} value={e.id}>{e.clave ? `${e.clave} · ${e.nombre}` : e.nombre}</option>)}
      </select>
    </form>
  );
}
