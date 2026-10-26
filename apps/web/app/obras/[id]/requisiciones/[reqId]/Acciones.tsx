'use client';
import { useActionState } from 'react';
import { accionRequisicion } from '../../../../acciones';

export function Accion({ id, obraId, accion, texto, primario }: {
  id: string; obraId: string; accion: 'enviar' | 'aprobar' | 'devolver'; texto: string; primario?: boolean;
}) {
  const [estado, enviar, pendiente] = useActionState(accionRequisicion, null);
  return (
    <form className="acciones" action={enviar}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="obra_id" value={obraId} />
      <input type="hidden" name="accion" value={accion} />
      <button className={primario ? 'primario' : undefined} disabled={pendiente}>{texto}</button>
      {estado?.error && <span className="error" role="alert">{estado.error}</span>}
    </form>
  );
}

export function Excepcion({ id, obraId, lineaId }: { id: string; obraId: string; lineaId: string }) {
  const [estado, enviar, pendiente] = useActionState(accionRequisicion, null);
  return (
    <form action={enviar} style={{ display: 'grid', gap: 6, minWidth: 220 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="obra_id" value={obraId} />
      <input type="hidden" name="accion" value="excepciones" />
      <input type="hidden" name="linea_id" value={lineaId} />
      <textarea name="justificacion" rows={2} placeholder="Justificación de la excepción" required minLength={5} />
      <button disabled={pendiente}>Autorizar excepción</button>
      {estado?.error && <span className="error" role="alert">{estado.error}</span>}
    </form>
  );
}
