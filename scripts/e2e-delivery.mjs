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
  if (destino && conv) {
    const board = (await api("/api/pipeline/board")).json;
    const lead = (board?.columns ?? [])
      .flatMap((c) => c.leads ?? [])
      .find((l) => l.contact?.name === nombre(90));
    if (lead) {
      await api(`/api/pipeline/leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify({ stageId: destino.id }),
      });
    }
  }
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
  const conv3 = await conversacionDe(3);
  const board = (await api("/api/pipeline/board")).json;
  const lead3 = (board?.columns ?? [])
    .flatMap((c) => c.leads ?? [])
    .find((l) => l.contact?.name === nombre(3));
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

  console.log("== J. Sandbox del Laboratorio ==");

  if (conv3) {
    const antesLab = (await pinDelMock()).count;
    const [testConv] = await sql`
      select id, contact_id from conversation where is_test = true limit 1
    `;
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
      console.log("  (sin conversación de prueba en la instancia: se omite)");
    }
  }
}

async function main() {
  console.log(
    `== Setup (DELIVERY ${DELIVERY ? "encendido" : "apagado"}) ==`
  );
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));

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
