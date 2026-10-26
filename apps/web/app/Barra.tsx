import Link from 'next/link';
import { cerrarSesion } from './acciones';

export function Barra({ usuario }: { usuario: string }) {
  return (
    <header className="barra">
      <Link href="/"><strong>ObraClara</strong></Link>
      <span>
        {usuario}{' '}
        <form className="acciones" action={cerrarSesion}><button>Salir</button></form>
      </span>
    </header>
  );
}
