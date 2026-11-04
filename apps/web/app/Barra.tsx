import Link from 'next/link';
import type { EmpresaAcceso } from '@obraclara/contracts';
import { api } from '@/lib/api';
import { cerrarSesion } from './acciones';
import { SelectorEmpresa } from './SelectorEmpresa';

export async function Barra({ usuario }: { usuario: string }) {
  const empresas = await api<EmpresaAcceso[]>('/v1/auth/empresas');
  return (
    <header className="barra">
      <nav className="nav">
        <Link href="/"><strong>ObraClara</strong></Link>
        <Link href="/">Obras</Link>
        <Link href="/checador">Checador</Link>
        {empresas.length > 1 && <Link href="/grupo">Grupo</Link>}
      </nav>
      <span className="nav">
        <SelectorEmpresa empresas={empresas} />
        {usuario}
        <form className="acciones" action={cerrarSesion}><button>Salir</button></form>
      </span>
    </header>
  );
}
