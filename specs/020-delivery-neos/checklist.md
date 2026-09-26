# Checklist de calidad — 020 Operación de delivery

Se marca al cerrar la feature, no antes. Cada renglón es verificable.

## La bandera (ADR-001)

- [ ] Sin `DELIVERY`, toda ruta de `/api/delivery/**` responde 404 sin cuerpo.
- [ ] Sin la bandera, `/kds`, `/delivery` y `/settings/delivery` responden 404.
- [ ] Sin la bandera, el menú no menciona Cocina ni Delivery.
- [ ] Sin la bandera, el agente no tiene la acción de pedido ni la nombra en su
      prompt.
- [ ] Sin la bandera, mover leads por el pipeline no crea pedidos.
- [ ] La migración se aplica igual, encendida o apagada.
- [ ] La bandera se lee de `process.env` directo, no del validador: preguntar
      si una feature existe no puede depender de que todo el entorno valide.

## Seguridad del código de recepción

- [ ] El código en claro no se persiste en ninguna columna.
- [ ] El código en claro no aparece en ninguna respuesta de API. Verificado por
      el test de fuga, no por inspección a ojo.
- [ ] El código en claro no se escribe en ningún log.
- [ ] Ninguna pantalla del CRM lo muestra.
- [ ] La huella es HMAC con clave derivada de `ENCRYPTION_KEY`, no un hash
      pelado.
- [ ] La comparación es en tiempo constante.
- [ ] Hay tope de intentos y se respeta.
- [ ] El sobre reversible se borra al llegar el pedido a estado terminal.
- [ ] La verificación nunca lee el sobre reversible.

## Corrección del dominio

- [ ] Los estados solo avanzan. Todo retroceso se rechaza, en la API y en la
      interfaz.
- [ ] Cancelar es terminal y se alcanza desde cualquier estado no terminal.
- [ ] Cada cambio de estado escribe su renglón en la bitácora.
- [ ] La bitácora es append-only: nada se actualiza ni se borra.
- [ ] El test de vigilancia falla si aparece una escritura de estado o de
      bitácora fuera del servicio.
- [ ] Un pedido tiene exactamente un origen y se distingue en la cola.
- [ ] La creación desde el pipeline es idempotente por movimiento de etapa,
      resuelta con un índice único y conflicto ignorado, no con un chequeo
      previo.

## Robustez

- [ ] Un fallo del proveedor deja el pedido en camino con el envío fallido y su
      motivo. Nunca revertido, nunca colgado.
- [ ] Ventana cerrada sin plantilla: el pedido avanza y el envío queda
      pendiente con su motivo.
- [ ] Pedido sin conversación: el envío queda como no enviable y el pedido
      opera normal.
- [ ] El reenvío manda el mismo código, nunca uno nuevo.
- [ ] El envío ocurre fuera de la transacción que cambia el estado.
- [ ] Dos operadores moviendo el mismo pedido: gana el primero y el segundo ve
      el conflicto.

## Multi-tenancy

- [ ] `organization_id NOT NULL` en las cuatro tablas.
- [ ] Todo acceso pasa por `scoped()`.
- [ ] Un pedido, un motorizado o una configuración de otra organización
      responden 404, no 403.
- [ ] La etapa disparadora se valida contra las etapas de la organización.
- [ ] La plantilla del código se valida contra las plantillas aprobadas de la
      organización.

## El núcleo intacto

- [ ] El webhook de WhatsApp no cambió su contrato ni su deduplicación.
- [ ] El despachador de mensajes no cambió su firma.
- [ ] Las variantes existentes del bus de eventos no se tocaron. Las dos nuevas
      son puramente aditivas.
- [ ] El contrato de la conexión SSE, con su latido y su puesta al día al
      reconectar, es el mismo.
- [ ] Ninguna tabla existente ganó, perdió ni cambió una columna.

## Sandbox del Laboratorio

- [ ] Un pedido de prueba jamás dispara un envío real.
- [ ] La aserción va antes de salir, como en el despachador y en los conectores
      de agenda.

## Verificación

- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde.
- [ ] Arnés de comportamiento en verde con la bandera **encendida**.
- [ ] Arnés de comportamiento en verde con la bandera **apagada**.
- [ ] Los siete caminos infelices del quickstart, ejercitados a mano al menos
      una vez.
