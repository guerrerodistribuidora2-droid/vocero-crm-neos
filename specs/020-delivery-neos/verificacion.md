# Cómo cerrar la T050 — verificación en vivo

Pasos exactos para levantar el entorno y correr el arnés. Escrito para **esta**
máquina (Windows, sin pnpm instalado), no en genérico.

---

## 0. Tres trampas de este entorno

Antes de empezar, porque las tres hacen perder tiempo:

1. **`pnpm` no existe como comando aquí.** `corepack enable` falla con un error
   de permisos sobre `C:\Program Files\nodejs`. Lo que sí funciona, sin
   administrador, es invocar siempre a través de corepack:
   `corepack pnpm <lo-que-sea>`. Ya está preparada la versión 11.5.0.

2. **La consola es PowerShell 5.1.** Redirigir la salida de error de un
   ejecutable con `2>&1` hace que el comando *parezca* fallar aunque haya
   devuelto cero. No lo uses; comprueba `$LASTEXITCODE` después de cada paso.

3. **Cambiar la bandera exige reiniciar el servidor.** `DELIVERY` se lee de
   `process.env` en cada petición, pero el proceso de Next ya arrancó con el
   valor que tenía. Entre las dos corridas del arnés hay que parar y volver a
   levantar la app, o la segunda mentirá.

## 1. Base de datos

```powershell
docker compose -f docker-compose.dev.yml up -d
```

Levanta PostgreSQL 16 en el puerto 5432, con usuario `postgres`, contraseña
`postgres` y base `vocero`.

## 2. El archivo `.env`

No existe en el repo (está en gitignore). Créalo en la raíz. Ojo con el host de
la base: el `.env.example` apunta a `postgres`, que es el nombre del servicio
**dentro** de la red de contenedores. Corriendo la app en la máquina, es
`localhost`.

```bash
APP_BASE_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vocero
BETTER_AUTH_SECRET=un-secreto-largo-cualquiera-para-desarrollo
ENCRYPTION_KEY=<32 bytes en base64, ver abajo>
META_WEBHOOK_VERIFY_TOKEN=token-de-verificacion-local

# Los mocks: sin esto el arnés hablaría con Meta de verdad.
WA_MOCK_ENABLED=true
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock

# La bandera de esta feature. Se quita para la segunda corrida.
DELIVERY=on
```

La clave de cifrado tiene que ser exactamente 32 bytes en base64, o el arranque
falla con un mensaje claro:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 3. Migrar y levantar

```powershell
corepack pnpm install --frozen-lockfile   # si no lo hiciste ya
corepack pnpm db:migrate
corepack pnpm dev
```

La migración `0015_delivery_neos.sql` es aditiva y re-ejecutable: se puede
correr sobre una base con datos sin perder nada.

## 4. Las dos corridas

En **otra** terminal, con la app viva:

### Con la bandera encendida

```powershell
corepack pnpm test:e2e:delivery
```

Conduce el guion completo: pedido desde la conversación, la cocina con sus
rechazos de retroceso y de salto, alta y asignación de motorizado, el envío del
código, la comprobación de que **no** aparece en ninguna superficie, el
reenvío del mismo código, el cierre con código, los caminos infelices y el
sandbox del Laboratorio.

### Sin la bandera

Quita `DELIVERY=on` del `.env`, **reinicia la app** (trampa 3) y vuelve a
correr el mismo comando:

```powershell
corepack pnpm test:e2e:delivery
```

Ahora comprueba lo contrario: que toda la superficie responde 404, que las tres
pantallas no existen y que mover leads no crea ningún pedido.

## 5. Qué esperar

Cada corrida imprime una línea por comprobación y termina con el recuento. Sale
con código distinto de cero si algo falla, así que sirve en CI tal cual.

```
== 41/41 comprobaciones en verde ==
```

Con las dos corridas en verde, la T050 se cierra y la feature 020 pasa a
**Hecha**. Hay que actualizar entonces tres sitios: la casilla de la T050, el
encabezado de `spec.md` y la nota de estado en
`memory/delivery-estado-de-la-feature.md`.

## 6. Si algo se pone rojo

El arnés dice qué comprobación falló y con qué respuesta. Dos consejos
concretos:

- Un fallo en la sección del código de recepción casi siempre es el simulador:
  comprueba que `META_GRAPH_BASE_URL` apunta al wa-mock y que
  `WA_MOCK_ENABLED=true`. Si el CRM habla con Meta de verdad, el buzón del mock
  está vacío y no hay código que leer.
- Un fallo en la sección del pipeline suele ser que la instancia no tiene dos
  etapas abiertas. El arnés necesita mover un lead de una etapa a otra.

No relajes ninguna comprobación para ponerla en verde. Las que vigilan que el
código no se filtre son el propósito de la feature, no un requisito de estilo.
