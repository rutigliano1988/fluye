# Fluye para Windows

Primer MVP de una aplicación de dictado inteligente para Windows, inspirado en la experiencia de Wispr Flow. **Fluye** es un nombre provisional.

## Qué funciona

- Atajo global `Ctrl + Alt + Espacio` para iniciar y detener el dictado.
- Modo mantener pulsado: mantén el atajo mientras hablas y suéltalo para terminar.
- Edición por voz de texto seleccionado con `Ctrl + Alt + Shift + Espacio`: di “hazlo más formal”, “resúmelo” o cualquier otra instrucción y Fluye reemplaza solo la selección.
- Captura visual de nuevos atajos sin tener que escribir el formato de Electron.
- Captura de micrófono con cancelación de eco y ruido.
- Medidor de volumen real mientras hablas.
- Transcripción completamente local mediante Whisper Base: sin clave API y sin enviar el audio a Internet.
- Transcripción en tiempo real mediante `gpt-live-transcribe`, visible mientras hablas.
- Latencia en vivo configurable y vocabulario aplicado desde el inicio de la sesión.
- Respaldo automático mediante `gpt-transcribe` si la conexión WebSocket no está disponible o se interrumpe.
- Cuatro modos: texto limpio, literal, mensaje y correo.
- Pulido opcional mediante la Responses API y `gpt-6-luna`.
- Pegado automático en la aplicación que estaba activa.
- Destino bloqueado: Fluye recuerda la ventana donde empezó el dictado y vuelve a ella al insertar.
- Restauración del portapapeles después de pegar; si la inserción falla, conserva el resultado para pegarlo manualmente.
- Indicador flotante con logotipo, contador y transcripción en vivo; aparece en el monitor donde estás trabajando sin robar el foco.
- Bandeja del sistema y opción de inicio con Windows.
- Diccionario personal para nombres, marcas y términos técnicos.
- Correcciones aprendidas con el formato `forma detectada → forma correcta`.
- Historial local de los últimos 50 dictados.
- Clave de API cifrada con la protección del sistema operativo de Electron (`safeStorage`, respaldada por Windows DPAPI).
- Asistente de primera ejecución para elegir el motor, comprobar el micrófono y aprender los atajos.
- Instalador asistido de Windows con icono propio, accesos directos y apertura automática al terminar.
- Actualizaciones integradas desde las versiones públicas de GitHub Releases.

## Puesta en marcha

Requisitos: Windows 10/11 y Node.js 22 o posterior. La clave de OpenAI es opcional
si se selecciona el motor local.

```powershell
npm install
npm run dev
```

También puedes hacer doble clic en `Abrir-Fluye.cmd`. No abras
`src/renderer/index.html` directamente: es una plantilla que Electron y el
servidor de desarrollo deben procesar.

Si una instalación anterior dejó Electron sin su ejecutable, repáralo con:

```powershell
npm run repair:electron
npm run dev
```

La reparación usa el espejo que la documentación de Electron recomienda para
redes sin acceso a GitHub Releases. El archivo descargado se valida contra los
checksums oficiales incluidos en el paquete.

Al abrir Fluye por primera vez:

1. Entra en **Ajustes**.
2. Elige **Local · Whisper Base** o añade tu clave para usar **OpenAI**.
3. Guarda los ajustes.
4. Abre cualquier editor de texto, mantén `Ctrl + Alt + Espacio`, habla y suelta el atajo.

Para editar texto existente, selecciónalo en la aplicación de destino, mantén
`Ctrl + Alt + Shift + Espacio`, di el cambio y suelta. Ambos atajos se pueden
personalizar desde **Ajustes**.

En **Ajustes → Activación del atajo** puedes recuperar el comportamiento de
pulsar una vez para iniciar y otra para terminar.

Windows solicitará acceso al micrófono la primera vez.

## Compilar e instalar

```powershell
npm run build
npm run dist
```

La versión actual se genera en `release-package/Fluye-Setup-0.4.0.exe`. El instalador
permite elegir la carpeta, crea accesos directos en el escritorio y el menú
Inicio, y abre Fluye al terminar. En el primer arranque aparece el asistente de
configuración; puede volver a abrirse desde **Ajustes → Conexión**.

### Publicar una versión

Las actualizaciones usan el repositorio público
[`rutigliano1988/fluye`](https://github.com/rutigliano1988/fluye). Para publicar:

1. Actualiza `version` en `package.json` y `package-lock.json`.
2. Confirma los cambios y crea una etiqueta con el mismo número, por ejemplo `v0.4.0`.
3. Sube la etiqueta a GitHub.
4. El workflow `Release Windows` compila el instalador y publica el `.exe`, su
   blockmap y `latest.yml` en GitHub Releases.

Las versiones ya instaladas consultan ese canal al arrancar, cada seis horas y
cuando se pulsa **Ajustes → Actualizaciones → Buscar actualizaciones**. La descarga
requiere confirmación y la instalación solo comienza al pulsar **Reiniciar e instalar**.

## Privacidad

Con el motor **Local**, el audio se procesa en el equipo mediante Whisper Base y no
se envía a Internet. El resultado aparece al terminar de hablar. Con el motor
**OpenAI**, el audio se transmite a su API y Fluye conserva temporalmente una
grabación en memoria para completar el dictado si la sesión en vivo falla. Si el
modo no es **Literal**, la transcripción se envía a la Responses API para
corregirla. Al editar por voz, el texto seleccionado y la instrucción hablada se
envían a la Responses API para generar el reemplazo. Estas solicitudes usan
`store: false`.

La clave de API se guarda cifrada para el usuario actual de Windows. El historial permanece en el almacenamiento local de la aplicación. Puede borrarse desde la pantalla **Historial**.

Consulta la documentación oficial de [transcripción en tiempo real](https://developers.openai.com/api/docs/guides/realtime-transcription), de [transcripción de audio](https://developers.openai.com/api/docs/guides/speech-to-text) y de la [Responses API](https://developers.openai.com/api/docs/guides/text).

## Estructura

```text
src/
├── main/       Proceso principal: ventanas, atajos, bandeja, API y pegado
├── preload/    Puente IPC limitado y tipado
├── renderer/   Interfaz React y captura de micrófono
└── shared/     Tipos compartidos
```

## Limitaciones del MVP

- El pegado utiliza `Ctrl + V` a través de Windows. Una aplicación ejecutada como administrador puede rechazar la entrada de Fluye si Fluye no tiene el mismo nivel de permisos.
- La red debe permitir conexiones WebSocket seguras para ver la transcripción en vivo. Si las bloquea, Fluye usa automáticamente la grabación por archivo al terminar.
- La transcripción local aparece al terminar; el texto en vivo requiere el motor OpenAI y conexión a Internet.
- Los modos generativos y la edición de una selección requieren una clave de OpenAI. El dictado local básico no la necesita.
- El instalador aún no está firmado digitalmente, por lo que Windows SmartScreen puede mostrar un aviso durante desarrollo.
