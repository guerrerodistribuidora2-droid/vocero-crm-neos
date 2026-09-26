---
name: entorno-windows-pnpm
description: En esta máquina Windows pnpm solo corre como "corepack pnpm"; corepack enable falla por permisos.
metadata:
  type: reference
---

La máquina de trabajo es Windows 11 y no tiene pnpm instalado, aunque el repo
lo exige con `packageManager: pnpm@11.5.0`.

`corepack enable` **falla** con `EPERM: operation not permitted` al intentar
escribir el atajo en `C:\Program Files\nodejs\`, porque esa carpeta pide
permisos de administrador.

**Cómo aplicarlo:** lo que sí funciona, sin administrador, es preparar la
versión y luego invocar siempre a través de corepack:

```
corepack prepare pnpm@11.5.0 --activate
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
```

Segundo detalle del mismo entorno: la consola es PowerShell 5.1, donde
redirigir la salida de error de un ejecutable nativo con `2>&1` envuelve cada
línea en un registro de error y hace que el comando parezca fallar aunque haya
devuelto cero. El gate técnico se corre **sin** esa redirección, comprobando
`$LASTEXITCODE` después de cada paso.

Relacionado: [[encargo-neos]].
