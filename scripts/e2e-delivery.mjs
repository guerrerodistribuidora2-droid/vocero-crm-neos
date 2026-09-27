/**
 * Self-test E2E de comportamiento — OPERACIÓN DE DELIVERY (spec 020,
 * tests/e2e/us-delivery.md).
 *
 * Conduce el flujo REAL de punta a punta contra la app viva: siembra por el
 * webhook (wa-mock), mueve el pedido por la cocina y la calle, y comprueba lo
 * único que de verdad importa de esta feature — que el código de recepción le
 * llega al cliente y NO aparece por ninguna parte del CRM.
 *
 * Corre en las DOS configuraciones de la bandera y se adapta solo:
 *
 *   sin DELIVERY  → comprueba que TODA la superficie responde 404 y que mover
 *                   leads no crea pedidos. El CRM es el de siempre.
 *   DELIVERY=on   → el guion completo, caminos infelices incluidos.
 *
 * Uso: pnpm test:e2e:delivery  (= node --env-file=.env scripts/e2e-delivery.mjs)
 * Requiere: app viva con los mocks (WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL →
 * wa-mock) y la BD migrada.
 */
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-DEL-1";
const RUN = String(Date.now()).slice(-6);
const DELIVERY = /^(on|1|true|si|sí|yes)$/i.test(
  (process.env.DELIVERY ?? "").trim()
);

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hasta(cond, ms = 20000, paso = 300) {
  const fin = Date.now() + ms;
  for (;;) {
    try {
      const v = await cond();
      if (v) return v;
    } catch {
      /* reintenta */
    }
    if (Date.now() > fin) return null;
    await sleep(paso);
  }
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

const tel = (n) => `52158${RUN}${String(n).padStart(2, "0")}`;
const nombre = (n) => `Delivery ${RUN} ${n}`;

const entra = (n, texto) =>
  api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: tel(n),
      name: nombre(n),
      text: texto,
      waMessageId: `wamid.e2e.020.${RUN}.${n}.${Date.now()}`,
    }),
  });

async function conversacionDe(n) {
  return hasta(async () => {
    const convs = (await api("/api/conversations")).json?.conversations ?? [];
    return convs.find((c) => c.contact.name === nombre(n)) ?? null;
  });
}

/** El código REAL, leído del buzón del mock: en el CRM no se puede leer. */
async function pinDelMock() {
  const { json } = await api("/api/dev/wa-mock/delivery-pin");
  return json ?? { pin: null, envios: [], count: 0 };
}

async function pedido(id) {
  return (await api(`/api/delivery/orders/${id}`)).json;
}

/**
 * El lead de un contacto, esperando a que exista.
 *
 * Dos cosas que se aprendieron corriendo esto de verdad: `/api/pipeline/board`
 * devuelve `leads` en un arreglo PLANO (no columnas con leads dentro), y el
 * lead lo crea la actividad de la bandeja DESPUÉS de ingerir el mensaje, así
 * que consultarlo de inmediato es una carrera que se pierde.
 */
async function leadDe(n) {
  return hasta(async () => {
    const board = (await api("/api/pipeline/board")).json;
    return (board?.leads ?? []).find((l) => l.contact?.name === nombre(n)) ?? null;
  }, 15000);
}


/**
 * Deja a TODOS los motorizados fuera de turno.
 *
 * Las secciones B a I prueban el camino MANUAL: crear, cocinar, asignar a dedo.
 * Desde que existe la asignación automática, un pedido que pasa a `listo` sale
 * ya asignado si hay alguien libre, y esas secciones dejaban de medir lo que
 * decían medir — "no se puede despachar sin asignar" pasaba porque el pedido ya
 * venía asignado, no porque la regla funcionara.
 *
 * Así que el camino manual se prueba sin nadie libre, y el automático tiene su
 * propia sección con su propio repartidor.
 */
async function apagarMotorizados() {
  const previos = (await api("/api/delivery/couriers")).json?.couriers ?? [];
  for (const c of previos) {
    await api(`/api/delivery/couriers/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({ available: false }),
    });
  }
  return previos.length;
}

/* ============================================================
 * A. Sin la bandera, el delivery no existe
 * ============================================================ */
async function superficieApagada() {
  console.log("== A. Sin la bandera, el delivery no existe ==");

  const rutas = [
    "/api/delivery/orders",
    "/api/delivery/couriers",
    "/api/delivery/settings",
  ];
  for (const ruta of rutas) {
    const { res } = await api(ruta);
    ok(`${ruta} responde 404`, res.status === 404, `status ${res.status}`);
  }

  const verify = await api("/api/delivery/orders/ord_x/verify-pin", {
    method: "POST",
    body: JSON.stringify({ pin: "123456" }),
  });
  ok("verify-pin responde 404", verify.res.status === 404);

  for (const page of ["/kds", "/delivery", "/settings/delivery"]) {
    const res = await fetch(`${BASE}${page}`, { headers: { cookie } });
    ok(`la pantalla ${page} responde 404`, res.status === 404, `status ${res.status}`);
  }

  // Mover un lead no puede crear pedidos: la tabla existe (la migración se
  // aplica siempre) pero tiene que quedarse vacía de esta corrida.
  await entra(90, `Hola, soy ${RUN}`);
  const conv = await conversacionDe(90);
  ok("la conversación entra normal, como siempre", !!conv);

  const antes = await sql`select count(*)::int as n from delivery_order`;
  const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
  const destino = stages[1] ?? stages[0];
  const lead = conv ? await leadDe(90) : null;
  if (destino && lead) {
    await api(`/api/pipeline/leads/${lead.id}`, {
      method: "PATCH",
      body: JSON.stringify({ stageId: destino.id }),
    });
  }
  ok("el lead existe y se pudo mover", !!lead);
  await sleep(600);
  const despues = await sql`select count(*)::int as n from delivery_order`;
  ok(
    "mover un lead no crea ningún pedido",
    antes[0].n === despues[0].n,
    `${antes[0].n} → ${despues[0].n}`
  );
}

/* ============================================================
 * B–J. Con la bandera, el guion completo
 * ============================================================ */
async function guionCompleto() {
  // El camino manual se mide sin nadie libre: ver `apagarMotorizados`.
  await apagarMotorizados();

  console.log("== B. Un pedido nace en la conversación ==");

  await entra(1, `Quiero pedir, soy ${RUN}`);
  const conv = await conversacionDe(1);
  ok("la conversación existe", !!conv);
  if (!conv) return;

  const alta = await api("/api/delivery/orders", {
    method: "POST",
    body: JSON.stringify({
      contactId: conv.contact.id,
      conversationId: conv.id,
      items: "2 tacos al pastor, 1 agua",
      address: `Calle ${RUN} 123`,
    }),
  });
  ok("el pedido se crea", alta.res.status === 201, JSON.stringify(alta.json));
  const orderId = alta.json?.orderId;
  if (!orderId) return;

  const cola = (await api("/api/delivery/orders")).json?.orders ?? [];
  const mio = cola.find((o) => o.id === orderId);
  ok("aparece en la cola con origen whatsapp", mio?.source === "whatsapp");
  ok("nace en recibido", mio?.state === "recibido");
  ok("no pide detalle: el agente ya lo trajo", mio?.needsDetail === false);

  console.log("== D. La cocina: los estados solo avanzan ==");

  const aCocina = await api(`/api/delivery/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "en_cocina" }),
  });
  ok("pasa a en preparación", aCocina.res.ok, JSON.stringify(aCocina.json));

  const atras = await api(`/api/delivery/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "recibido" }),
  });
  ok(
    "volver atrás se rechaza con 409 retroceso",
    atras.res.status === 409 && atras.json?.error?.code === "retroceso",
    JSON.stringify(atras.json)
  );

  const aListo = await api(`/api/delivery/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "listo" }),
  });
  ok("pasa a listo", aListo.res.ok);

  const salto = await api(`/api/delivery/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "en_camino" }),
  });
  ok(
    "no se puede despachar sin asignar (salto_no_permitido)",
    salto.res.status === 409 && salto.json?.error?.code === "salto_no_permitido",
    JSON.stringify(salto.json)
  );

  console.log("== E. La calle ==");

  const alt = await api("/api/delivery/couriers", {
    method: "POST",
    body: JSON.stringify({ name: `Luis ${RUN}`, phone: "5215550000" }),
  });
  ok("motorizado dado de alta", alt.res.status === 201, JSON.stringify(alt.json));
  const courierId = alt.json?.courier?.id;

  const sinCourier = await api(`/api/delivery/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "asignado" }),
  });
  ok(
    "asignar sin motorizado se rechaza",
    sinCourier.res.status === 422 &&
      sinCourier.json?.error?.code === "courier_required"
  );

  const asignado = await api(`/api/delivery/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "asignado", courierId }),
  });
  ok("se asigna al motorizado", asignado.res.ok, JSON.stringify(asignado.json));

  console.log("== F. El código de recepción ==");

  const antesDelEnvio = (await pinDelMock()).count;

  const enCamino = await api(`/api/delivery/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "en_camino" }),
  });
  ok("sale a la calle", enCamino.res.ok, JSON.stringify(enCamino.json));
  ok(
    "el código se envió",
    enCamino.json?.pin?.status === "enviado",
    JSON.stringify(enCamino.json?.pin)
  );

  const mock = await pinDelMock();
  ok("el mock recibió un mensaje con el código", mock.count === antesDelEnvio + 1);
  const PIN = mock.pin;
  ok("el código es de dígitos", !!PIN && /^\d{4,10}$/.test(PIN), String(PIN));
  if (!PIN) return;

  // LA comprobación de la feature: el código no sale por ninguna superficie.
  const ficha = await pedido(orderId);
  const fichaCruda = JSON.stringify(ficha);
  ok("la ficha del pedido NO contiene el código", !fichaCruda.includes(PIN));
  ok("la ficha no expone la huella", !fichaCruda.includes("pinHash"));
  ok("la ficha no expone el sobre", !fichaCruda.includes("pinSealed"));

  const listado = JSON.stringify((await api("/api/delivery/orders")).json);
  ok("el listado NO contiene el código", !listado.includes(PIN));

  const hilo = JSON.stringify(
    (await api(`/api/conversations/${conv.id}/messages`)).json
  );
  ok("el hilo de la bandeja NO contiene el código", !hilo.includes(PIN));
  ok("el hilo sí muestra el mensaje, enmascarado", hilo.includes("•"));

  console.log("== F.5 Reenvío: el mismo código, nunca uno nuevo ==");

  const reenvio = await api(`/api/delivery/orders/${orderId}/resend-pin`, {
    method: "POST",
  });
  ok("el reenvío responde", reenvio.res.ok, JSON.stringify(reenvio.json));
  const tras = await pinDelMock();
  ok("salió otro mensaje", tras.count === mock.count + 1);
  ok("con EL MISMO código", tras.pin === PIN, `${tras.pin} vs ${PIN}`);

  console.log("== H. Cerrar la entrega ==");

  const malo = await api(`/api/delivery/orders/${orderId}/verify-pin`, {
    method: "POST",
    body: JSON.stringify({ pin: PIN === "111111" ? "222222" : "111111" }),
  });
  ok(
    "un código incorrecto se rechaza con 422",
    malo.res.status === 422 && malo.json?.error?.code === "pin_incorrecto",
    JSON.stringify(malo.json)
  );
  ok(
    "el error no filtra el código",
    !JSON.stringify(malo.json).includes(PIN)
  );

  const trasFallo = await pedido(orderId);
  ok("el pedido sigue en camino", trasFallo?.order?.state === "en_camino");
  ok("el intento fallido quedó en la bitácora", trasFallo.log.length >= 1);
  ok("el contador de intentos subió", trasFallo?.order?.pinAttempts === 1);

  const bueno = await api(`/api/delivery/orders/${orderId}/verify-pin`, {
    method: "POST",
    body: JSON.stringify({ pin: PIN }),
  });
  ok("el código correcto cierra la entrega", bueno.res.ok, JSON.stringify(bueno.json));

  const final = await pedido(orderId);
  ok("el pedido queda entregado", final?.order?.state === "entregado");
  ok("con su hora sellada", !!final?.order?.deliveredAt);
  ok(
    "la bitácora no filtra el código",
    !JSON.stringify(final.log).includes(PIN)
  );

  const reenvioCerrado = await api(
    `/api/delivery/orders/${orderId}/resend-pin`,
    { method: "POST" }
  );
  ok(
    "cerrado el pedido, ya no hay código que reenviar",
    reenvioCerrado.json?.status === "fallido",
    JSON.stringify(reenvioCerrado.json)
  );

  console.log("== G. Camino infeliz: ventana cerrada sin plantilla ==");

  await entra(2, `Segundo pedido ${RUN}`);
  const conv2 = await conversacionDe(2);
  const alta2 = await api("/api/delivery/orders", {
    method: "POST",
    body: JSON.stringify({
      contactId: conv2.contact.id,
      conversationId: conv2.id,
      items: "1 pizza",
    }),
  });
  const id2 = alta2.json?.orderId;

  // Empuja el último entrante fuera de la ventana de 24 h.
  await sql`update conversation set last_inbound_at = now() - interval '30 hours' where id = ${conv2.id}`;
  await api("/api/delivery/settings", {
    method: "PUT",
    body: JSON.stringify({ pinTemplateId: null }),
  });

  await api(`/api/delivery/orders/${id2}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "listo" }),
  });
  const alt2 = await api("/api/delivery/couriers", {
    method: "POST",
    body: JSON.stringify({ name: `Ana ${RUN}` }),
  });
  await api(`/api/delivery/orders/${id2}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "asignado", courierId: alt2.json?.courier?.id }),
  });
  const salida2 = await api(`/api/delivery/orders/${id2}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "en_camino" }),
  });

  ok("el pedido SALE igual a la calle", salida2.res.ok);
  ok(
    "el envío queda pendiente, no fallido ni colgado",
    salida2.json?.pin?.status === "pendiente",
    JSON.stringify(salida2.json?.pin)
  );
  ok(
    "y dice por qué",
    typeof salida2.json?.pin?.error === "string" &&
      salida2.json.pin.error.includes("24 h")
  );
  const ficha2 = await pedido(id2);
  ok("la ficha lo muestra en camino", ficha2?.order?.state === "en_camino");

  console.log("== I. Cierre sin código ==");

  const sinMotivo = await api(`/api/delivery/orders/${id2}/force-deliver`, {
    method: "POST",
    body: JSON.stringify({ reason: "" }),
  });
  ok("cerrar sin motivo se rechaza", sinMotivo.res.status === 422);

  const forzado = await api(`/api/delivery/orders/${id2}/force-deliver`, {
    method: "POST",
    body: JSON.stringify({ reason: "El cliente no recibió el mensaje" }),
  });
  ok("con motivo, se cierra", forzado.res.ok, JSON.stringify(forzado.json));

  const ficha2f = await pedido(id2);
  ok("queda entregado", ficha2f?.order?.state === "entregado");
  ok(
    "la bitácora dice SIN código, con esas palabras",
    ficha2f.log.some((e) => (e.detail ?? "").includes("SIN código")),
    JSON.stringify(ficha2f.log.map((e) => e.detail))
  );

  console.log("== C. Un pedido nace en el tablero ==");

  const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
  const disparadora = stages.find((s) => s.kind === "open") ?? stages[0];
  const cfg = await api("/api/delivery/settings", {
    method: "PUT",
    body: JSON.stringify({ orderStageId: disparadora.id }),
  });
  ok("la etapa disparadora se guarda", cfg.res.ok, JSON.stringify(cfg.json));

  const ajena = await api("/api/delivery/settings", {
    method: "PUT",
    body: JSON.stringify({ orderStageId: "stg_de_otro_negocio" }),
  });
  ok(
    "una etapa ajena se rechaza",
    ajena.res.status === 422 && ajena.json?.error?.code === "etapa_invalida"
  );
  await api("/api/delivery/settings", {
    method: "PUT",
    body: JSON.stringify({ orderStageId: disparadora.id }),
  });

  await entra(3, `Tercero ${RUN}`);
  await conversacionDe(3);
  const lead3 = await leadDe(3);
  ok("el lead del tercero existe", !!lead3);

  if (lead3) {
    const otra = stages.find((s) => s.id !== lead3.stageId && s.kind === "open");
    if (otra) {
      await api(`/api/delivery/settings`, {
        method: "PUT",
        body: JSON.stringify({ orderStageId: otra.id }),
      });
      await api(`/api/pipeline/leads/${lead3.id}`, {
        method: "PATCH",
        body: JSON.stringify({ stageId: otra.id }),
      });

      const delPipeline = await hasta(async () => {
        const todos = (await api("/api/delivery/orders")).json?.orders ?? [];
        return todos.find((o) => o.source === "pipeline" && o.leadId === lead3.id);
      }, 8000);

      ok("el movimiento de etapa creó un pedido", !!delPipeline);
      ok(
        "y llega marcado como pendiente de detallar",
        delPipeline?.needsDetail === true,
        JSON.stringify(delPipeline?.items)
      );

      // Idempotencia: volver a entrar a la MISMA etapa no duplica el pedido
      // de ese movimiento (uno nuevo sí puede crear otro, y debe).
      const antes = (await api("/api/delivery/orders")).json?.orders?.length ?? 0;
      await api(`/api/pipeline/leads/${lead3.id}`, {
        method: "PATCH",
        body: JSON.stringify({ stageId: otra.id }),
      });
      await sleep(800);
      const despues = (await api("/api/delivery/orders")).json?.orders?.length ?? 0;
      ok(
        "reordenar en la misma etapa no crea otro pedido",
        antes === despues,
        `${antes} → ${despues}`
      );
    }
  }

  // Se deja apagado para no contaminar otras corridas del arnés.
  await api("/api/delivery/settings", {
    method: "PUT",
    body: JSON.stringify({ orderStageId: null, pinTemplateId: null }),
  });

  await seccionRepartidor();

  console.log("== J. Sandbox del Laboratorio ==");

  {
    const antesLab = (await pinDelMock()).count;

    /**
     * La conversación de prueba se fabrica aquí si no existe.
     *
     * Antes esta sección se OMITÍA cuando la instancia no tenía ninguna, y
     * omitirla es lo peor que podía pasar: es la que comprueba el guardarraíl
     * del Laboratorio, o sea que un pedido de prueba jamás manda un mensaje
     * real. Una comprobación que se salta sola no protege nada.
     *
     * Se toca la base directo, como hace e2e-resultados, solo para lo que el
     * webhook no puede fabricar: una conversación marcada `is_test`.
     */
    const [org] = await sql`select id from organization limit 1`;
    let [testConv] = await sql`
      select id, contact_id from conversation where is_test = true limit 1
    `;
    if (!testConv && org) {
      const ctId = `ct_lab${RUN}`;
      const cvId = `cv_lab${RUN}`;
      await sql`
        insert into contact (id, organization_id, wa_identity, phone, name)
        values (${ctId}, ${org.id}, ${`lab-${RUN}`}, ${tel(99)}, ${`Lab ${RUN}`})
        on conflict do nothing
      `;
      await sql`
        insert into conversation (id, organization_id, contact_id, is_test, channel)
        values (${cvId}, ${org.id}, ${ctId}, true, 'whatsapp')
        on conflict do nothing
      `;
      [testConv] = await sql`
        select id, contact_id from conversation where id = ${cvId}
      `;
      ok("conversación de prueba fabricada para el guardarraíl", !!testConv);
    }

    if (testConv) {
      const labOrder = await api("/api/delivery/orders", {
        method: "POST",
        body: JSON.stringify({
          contactId: testConv.contact_id,
          conversationId: testConv.id,
          items: "Pedido de prueba",
        }),
      });
      const labId = labOrder.json?.orderId;
      if (labId) {
        const fichaLab = await pedido(labId);
        ok("el pedido de prueba nace marcado", fichaLab?.order?.isTest === true);

        await api(`/api/delivery/orders/${labId}`, {
          method: "PATCH",
          body: JSON.stringify({ state: "listo" }),
        });
        const altLab = await api("/api/delivery/couriers", {
          method: "POST",
          body: JSON.stringify({ name: `Lab ${RUN}` }),
        });
        await api(`/api/delivery/orders/${labId}`, {
          method: "PATCH",
          body: JSON.stringify({
            state: "asignado",
            courierId: altLab.json?.courier?.id,
          }),
        });
        const salidaLab = await api(`/api/delivery/orders/${labId}`, {
          method: "PATCH",
          body: JSON.stringify({ state: "en_camino" }),
        });

        ok(
          "un pedido de prueba NO envía nada real",
          salidaLab.json?.pin?.status === "no_enviable",
          JSON.stringify(salidaLab.json?.pin)
        );
        const despuesLab = await pinDelMock();
        ok(
          "el buzón del mock no recibió nada",
          despuesLab.count === antesLab,
          `${antesLab} → ${despuesLab.count}`
        );
      }
    } else {
      // No se omite en silencio: si no hubo con qué probar el guardarraíl,
      // esta corrida NO verificó el sandbox y tiene que decirlo en rojo.
      ok("hubo conversación de prueba con la que verificar el sandbox", false);
    }
  }
}

/* ============================================================
 * K. Panel del repartidor y asignación automática
 * ============================================================ */
async function seccionRepartidor() {
  console.log("== K. Asignación automática y panel del repartidor ==");

  // Fuera de turno todos los anteriores: el reparto automático debe elegir
  // entre los de ESTA sección y nada más.
  await apagarMotorizados();

  const altaA = await api("/api/delivery/couriers", {
    method: "POST",
    body: JSON.stringify({ name: `Auto A ${RUN}` }),
  });
  const driverA = altaA.json?.courier?.id;
  ok("motorizado para asignación automática dado de alta", !!driverA);

  const enlace = await api(`/api/delivery/couriers/${driverA}/access-link`, {
    method: "POST",
  });
  ok("se emite el enlace de acceso", enlace.res.ok, JSON.stringify(enlace.json));
  const driverPath = enlace.json?.path;
  const token = driverPath?.split("/").pop();
  ok("el enlace trae un token largo", (token ?? "").length >= 43);
  if (!token) return;

  const couriersTrasEnlace =
    (await api("/api/delivery/couriers")).json?.couriers ?? [];
  const serialized = couriersTrasEnlace.find((c) => c.id === driverA);
  ok("el listado dice que TIENE enlace", serialized?.hasAccessLink === true);
  ok(
    "y NO devuelve el enlace ni el token",
    !JSON.stringify(couriersTrasEnlace).includes(token)
  );

  // ── El cerrojo: dos pedidos listos a la vez, un solo repartidor ─────────
  const ids = [];
  for (const n of [11, 12]) {
    await entra(n, `Pedido concurrente ${n} ${RUN}`);
    const c = await conversacionDe(n);
    const alta = await api("/api/delivery/orders", {
      method: "POST",
      body: JSON.stringify({
        contactId: c.contact.id,
        conversationId: c.id,
        items: `Pedido ${n}`,
        address: `Calle ${RUN} ${n}`,
      }),
    });
    ids.push(alta.json?.orderId);
  }
  ok("dos pedidos creados para la carrera", ids.every(Boolean));

  // Los dos pasan a listo EN PARALELO: con un "consulta y luego asigna" los dos
  // se llevarían al mismo repartidor.
  const carrera = await Promise.all(
    ids.map((id) =>
      api(`/api/delivery/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "listo" }),
      })
    )
  );

  const asignados = carrera.filter((r) => r.json?.assigned?.courierName);
  const sinNadie = carrera.filter(
    (r) => r.json?.assigned?.reason === "sin_disponibles"
  );
  ok(
    "EL CERROJO: con un solo repartidor libre, solo UN pedido queda asignado",
    asignados.length === 1,
    `asignados=${asignados.length} sin_disponibles=${sinNadie.length}`
  );
  ok("el otro se queda esperando, no falla", sinNadie.length === 1);

  const couriersTrasCarrera =
    (await api("/api/delivery/couriers")).json?.couriers ?? [];
  const ocupado = couriersTrasCarrera.find((c) => c.id === driverA);
  ok("el repartidor queda ON_DELIVERY", ocupado?.status === "ON_DELIVERY");
  ok("y con UN solo pedido encima", !!ocupado?.currentOrderId);

  const suPedido = ocupado?.currentOrderId;

  // ── El panel del repartidor ────────────────────────────────────────────
  const vista = await api(`/api/driver/${token}/advance`);
  ok("el panel del repartidor responde con su token", vista.res.ok);
  ok("y trae SU pedido", vista.json?.order?.id === suPedido);
  ok("con la dirección para navegar", !!vista.json?.order?.address);
  ok(
    "el panel NO expone el código de recepción",
    !JSON.stringify(vista.json).includes("pinHash") &&
      !JSON.stringify(vista.json).includes("pinSealed")
  );

  const tokenFalso = "x".repeat(43);
  const conFalso = await api(`/api/driver/${tokenFalso}/advance`);
  ok("un token inventado responde 404", conFalso.res.status === 404);

  // Antes de salir se cuenta el buzón: así se comprueba que el código sale de
  // VERDAD al marcar la salida, y no que quedaba uno viejo de otra sección.
  const buzonAntes = (await pinDelMock()).count;

  const salida = await api(`/api/driver/${token}/advance`, {
    method: "POST",
    body: JSON.stringify({ to: "en_camino" }),
  });
  ok("el repartidor marca que salió", salida.res.ok, JSON.stringify(salida.json));
  ok("su pedido queda en camino", salida.json?.order?.state === "en_camino");
  ok(
    "salir desde el PANEL DEL REPARTIDOR también dispara el código",
    salida.json?.pin?.status === "enviado",
    JSON.stringify(salida.json?.pin)
  );
  ok(
    "y el buzón del cliente recibió ese mensaje nuevo",
    (await pinDelMock()).count === buzonAntes + 1
  );

  const noEntregable = await api(`/api/driver/${token}/advance`, {
    method: "POST",
    body: JSON.stringify({ to: "entregado" }),
  });
  ok(
    "el repartidor NO puede marcar entregado sin código",
    noEntregable.res.status === 422,
    `status ${noEntregable.res.status}`
  );

  // El código salió al pasar a en_camino: se lee del buzón del mock.
  const pinInfo = await pinDelMock();
  const PIN = pinInfo.pin;
  ok("el cliente recibió su código al salir el repartidor", !!PIN);

  const malo = await api(`/api/driver/${token}/deliver`, {
    method: "POST",
    body: JSON.stringify({ pin: PIN === "111111" ? "222222" : "111111" }),
  });
  ok("un código incorrecto se rechaza", malo.res.status === 422);
  ok("sin filtrar el código", !JSON.stringify(malo.json).includes(String(PIN)));

  const cierre = await api(`/api/driver/${token}/deliver`, {
    method: "POST",
    body: JSON.stringify({ pin: PIN }),
  });
  ok("con el código correcto, entrega cerrada", cierre.res.ok, JSON.stringify(cierre.json));
  ok("y el panel vuelve a estar libre", cierre.json?.order === null);
  ok(
    "el repartidor queda AVAILABLE para el siguiente",
    cierre.json?.courier?.status === "AVAILABLE"
  );

  const liberado = (await api("/api/delivery/couriers")).json?.couriers ?? [];
  const libre = liberado.find((c) => c.id === driverA);
  ok("el CRM también lo ve libre", libre?.currentOrderId === null);

  // ── Revocar el enlace ──────────────────────────────────────────────────
  const revoca = await api(`/api/delivery/couriers/${driverA}/access-link`, {
    method: "DELETE",
  });
  ok("el enlace se revoca", revoca.res.ok);
  const trasRevocar = await api(`/api/driver/${token}/advance`);
  ok(
    "y el enlace revocado deja de entrar de inmediato",
    trasRevocar.res.status === 404,
    `status ${trasRevocar.res.status}`
  );
}

async function main() {
  console.log(
    `== Setup (DELIVERY ${DELIVERY ? "encendido" : "apagado"}) ==`
  );
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  /**
   * Se intenta el registro y DESPUÉS se inicia sesión siempre.
   *
   * No es redundante: el registro puede devolver 200 sin dejar cookie de
   * sesión utilizable, y entonces la siguiente petición sale sin sesión y todo
   * el arnés cae en 401 con un mensaje que no apunta a la causa. Iniciar
   * sesión al final deja el estado en firme, exista ya la cuenta o no.
   *
   * Si el registro público está cerrado (ya hay una organización), el alta
   * falla y el inicio de sesión funciona igual cuando la cuenta ya existía.
   * Para una instancia con negocio real y sin esta cuenta, hace falta
   * ALLOW_SIGNUP=true.
   */
  await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  const su = await api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  ok("login del operador de pruebas", su.res.ok, JSON.stringify(su.json));

  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({
      wabaId: "WABA-DEL",
      phoneNumberId: PN,
      token: "tok-del",
    }),
  });
  ok("conexión WhatsApp guardada (vía wa-mock)", conn.res.ok);

  if (DELIVERY) await guionCompleto();
  else await superficieApagada();

  await sql.end({ timeout: 5 });

  console.log(
    `\n== ${checks - failures}/${checks} comprobaciones en verde ==`
  );
  if (failures) {
    console.log(`${failures} FALLARON`);
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await sql.end({ timeout: 5 });
  } catch {}
  process.exit(1);
});
