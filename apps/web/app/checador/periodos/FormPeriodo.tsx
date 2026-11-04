'use client';
import { useActionState } from 'react';
import { accionPeriodo } from '../../acciones';

export function NuevoPeriodo() {
  const [estado, enviar, pendiente] = useActionState(accionPeriodo, null);
  return (
    <form className="form-linea" action={enviar}>
      <input type="hidden" name="accion" value="crear" />
      <label>Nombre<input name="nombre" placeholder="Quincena del 1 al 15" required minLength={3} /></label>
      <label>Inicio<input type="date" name="inicio" required /></label>
      <label>Fin<input type="date" name="fin" required /></label>
      <button className="primario" disabled={pendiente}>Crear periodo</button>
      {estado?.error && <span className="error" role="alert">{estado.error}</span>}
      {estado?.ok && <span className="ok">{estado.ok}</span>}
    </form>
  );
}

export function CerrarPeriodo({ id }: { id: string }) {
  const [estado, enviar, pendiente] = useActionState(accionPeriodo, null);
  return (
    <form className="acciones" action={enviar}>
      <input type="hidden" name="accion" value="cerrar" />
      <input type="hidden" name="id" value={id} />
      <button disabled={pendiente}>Cerrar periodo</button>
      {estado?.error && <span className="error" role="alert">{estado.error}</span>}
    </form>
  );
}
