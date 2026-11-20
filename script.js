
/* ==================================================
   FUTAPP - SCRIPT PRINCIPAL
   Chat conversacional conectado con Make
================================================== */


/* ==================================================
   1. ELEMENTOS DEL DOM
================================================== */

const formulario = document.getElementById("zona-de-escritura");
const campoMensaje = document.getElementById("mensaje");
const botonEnviar = document.getElementById("btn-enviar");
const chatMensajes = document.getElementById("chat-messages");
const estadoChat = document.getElementById("chat-status");
const contador = document.getElementById("contador");


/* ==================================================
   2. CONFIGURACIÓN GENERAL
================================================== */

const MAX_CARACTERES = 500;
const TIEMPO_MINIMO = 1500;
const TIEMPO_LIMITE = 30000;

let ultimoEnvio = 0;
let estadoActual = "listo";
let sessionIdEnMemoria = null;


/* ==================================================
   3. VERIFICAR CONFIGURACIÓN DEL WEBHOOK
================================================== */

function obtenerWebhookUrl() {

    // Comprobar que config.js haya definido la constante.
    if (typeof WEBHOOK_URL === "undefined") {
        return null;
    }

    const url = WEBHOOK_URL.trim();

    // Comprobar que la URL no esté vacía ni sea de ejemplo.
    if (!url || url.includes("ACA VA")) {
        return null;
    }

    return url;
}


/* ==================================================
   4. IDENTIFICADOR ÚNICO DE SESIÓN
================================================== */

function generarSessionId() {

    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    ) {
        return crypto.randomUUID();
    }

    return Date.now().toString(36) +
        Math.random().toString(36).substring(2);
}


function obtenerSessionId() {

    try {

        const guardado = localStorage.getItem("futapp_session_id");

        if (guardado) {
            return guardado;
        }

        const nuevoId = generarSessionId();

        localStorage.setItem("futapp_session_id", nuevoId);

        return nuevoId;

    } catch (error) {

        // Alternativa cuando localStorage no está disponible.
        if (!sessionIdEnMemoria) {
            sessionIdEnMemoria = generarSessionId();
        }

        return sessionIdEnMemoria;
    }
}


// Se obtiene una sola vez al iniciar la aplicación.
const sessionId = obtenerSessionId();


/* ==================================================
   5. FUNCIONES DEL CHAT
================================================== */


// Crear mensajes de forma segura utilizando textContent.
function agregarMensaje(texto, tipo) {

    const burbuja = document.createElement("div");

    burbuja.classList.add("message", tipo);

    const etiqueta = document.createElement("span");

    etiqueta.classList.add("message-label");

    etiqueta.textContent = tipo === "user"
        ? "Vos"
        : "⚽ Futapp";

    const contenido = document.createElement("div");

    contenido.textContent = String(texto);

    burbuja.appendChild(etiqueta);
    burbuja.appendChild(contenido);

    chatMensajes.appendChild(burbuja);

    // Desplazar el chat hacia el último mensaje.
    chatMensajes.scrollTop = chatMensajes.scrollHeight;
}


// Actualizar el estado visual.
function actualizarEstado(tipo, texto) {

    estadoActual = tipo;

    estadoChat.className = "chat-status";

    if (tipo === "error") {
        estadoChat.classList.add("error");
    }

    if (tipo === "exito") {
        estadoChat.classList.add("success");
    }

    estadoChat.textContent = texto;
}


// Bloquear o habilitar controles.
function bloquearControles(bloquear) {

    campoMensaje.disabled = bloquear;
    botonEnviar.disabled = bloquear;
}


/* ==================================================
   6. CONTADOR DE CARACTERES
================================================== */

function actualizarContador() {

    const cantidad = campoMensaje.value.length;

    contador.textContent =
        `${cantidad}/${MAX_CARACTERES} caracteres`;
}


campoMensaje.addEventListener("input", actualizarContador);


/* ==================================================
   7. ENVÍO CON ENTER
================================================== */

// Enter envía.
// Shift + Enter permite escribir en otra línea.

campoMensaje.addEventListener("keydown", function(event) {

    if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing
    ) {

        event.preventDefault();

        formulario.requestSubmit();
    }

});


/* ==================================================
   8. PAUSA ENTRE ENVÍOS
================================================== */

function esperar(ms) {

    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });

}


/* ==================================================
   9. INTERPRETAR RESPUESTAS DE MAKE
================================================== */

function interpretarRespuesta(texto) {

    // Respuesta vacía.
    if (!texto || !texto.trim()) {
        return "(respuesta vacía)";
    }

    try {

        const datos = JSON.parse(texto);

        // Comprobar que sea un objeto JSON.
        if (
            datos !== null &&
            typeof datos === "object" &&
            !Array.isArray(datos)
        ) {

            // Orden de prioridad de los campos.
            const propiedades = [
                "response",
                "respuesta",
                "message",
                "mensaje"
            ];

            for (const propiedad of propiedades) {

                const valor = datos[propiedad];

                if (
                    typeof valor === "string" &&
                    valor.trim() !== ""
                ) {

                    return valor.trim();
                }

            }

            return "Make respondió, pero sin el campo response";
        }

        // Si es JSON válido pero no un objeto.
        return texto;

    } catch (error) {

        // Si no es JSON, mostrar el texto original.
        return texto;
    }

}


/* ==================================================
   10. FUNCIÓN PRINCIPAL DE ENVÍO
================================================== */

async function enviarMensaje(event) {

    event.preventDefault();

    // Evitar envíos simultáneos.
    if (botonEnviar.disabled) {
        return;
    }

    const mensaje = campoMensaje.value.trim();

    // Validar mensaje vacío.
    if (!mensaje) {
        campoMensaje.focus();
        return;
    }

    // Validar longitud.
    if (mensaje.length > MAX_CARACTERES) {

        actualizarEstado(
            "error",
            "El mensaje no puede superar los 500 caracteres."
        );

        return;
    }

    // Comprobar la configuración antes de enviar.
    const webhook = obtenerWebhookUrl();

    // Mostrar el mensaje del usuario.
    agregarMensaje(mensaje, "user");

    if (!webhook) {

        agregarMensaje(
            "Falta pegar la URL de tu webhook en config.js",
            "agent"
        );

        actualizarEstado(
            "error",
            "Configuración pendiente"
        );

        return;
    }

    // Limpiar el campo después de validar la configuración.
    campoMensaje.value = "";

    actualizarContador();

    // Bloquear controles mientras se procesa.
    bloquearControles(true);

    actualizarEstado(
        "cargando",
        "⚽ Futapp está pensando..."
    );

    let tiempoAgotado = false;
    let temporizador = null;

    try {

        /* ------------------------------------------
           RESPETAR PAUSA MÍNIMA ENTRE ENVÍOS
        ------------------------------------------ */

        const tiempoTranscurrido = Date.now() - ultimoEnvio;

        const tiempoEspera = Math.max(
            0,
            TIEMPO_MINIMO - tiempoTranscurrido
        );

        if (tiempoEspera > 0) {
            await esperar(tiempoEspera);
        }

        ultimoEnvio = Date.now();


        /* ------------------------------------------
           CONTROLAR TIEMPO MÁXIMO DE RESPUESTA
        ------------------------------------------ */

        const controlador = new AbortController();

        temporizador = setTimeout(() => {

            tiempoAgotado = true;

            controlador.abort();

        }, TIEMPO_LIMITE);


        /* ------------------------------------------
           ENVIAR INFORMACIÓN A MAKE
        ------------------------------------------ */

        const datosEnvio = {
            sessionId: sessionId,
            mensaje: mensaje,
            fecha: new Date().toISOString()
        };

        const respuesta = await fetch(webhook, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            // Exactamente tres campos.
            body: JSON.stringify(datosEnvio),

            signal: controlador.signal

        });


        /* ------------------------------------------
           LEER RESPUESTA DEL SERVIDOR
        ------------------------------------------ */

        const textoRespuesta = await respuesta.text();


        /* ------------------------------------------
           COMPROBAR ERRORES HTTP
        ------------------------------------------ */

        if (!respuesta.ok) {

            agregarMensaje(
                `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`,
                "agent"
            );

            actualizarEstado(
                "error",
                "Error HTTP: " + respuesta.status
            );

            return;
        }


        /* ------------------------------------------
           PROCESAR RESPUESTA EXITOSA
        ------------------------------------------ */

        const mensajeAgente = interpretarRespuesta(
            textoRespuesta
        );

        agregarMensaje(
            mensajeAgente,
            "agent"
        );


        // Identificar respuestas con formato inesperado.
        if (
            mensajeAgente ===
            "Make respondió, pero sin el campo response"
        ) {

            actualizarEstado(
                "error",
                "Respuesta recibida con formato inesperado"
            );

        } else {

            actualizarEstado(
                "exito",
                "✓ Respuesta recibida"
            );

        }


    } catch (error) {

        /* ------------------------------------------
           MANEJO DE ERRORES
        ------------------------------------------ */

        if (tiempoAgotado) {

            // Tiempo máximo de 30 segundos superado.
            agregarMensaje(
                "La solicitud tardó demasiado. Se agotó el tiempo de espera de 30 segundos. Intentá nuevamente.",
                "agent"
            );

            actualizarEstado(
                "error",
                "Tiempo de espera agotado"
            );

        } else {

            // Error de conexión, red o CORS.
            agregarMensaje(
                "No pude conectarme con Make. Revisá tu conexión, la URL del webhook y los permisos CORS de la respuesta del servidor.",
                "agent"
            );

            actualizarEstado(
                "error",
                "Error de conexión"
            );

            console.error(
                "Error al conectar con Make:",
                error
            );

        }

    } finally {

        /* ------------------------------------------
           LIMPIEZA Y RESTAURACIÓN DE LA INTERFAZ
        ------------------------------------------ */

        if (temporizador !== null) {
            clearTimeout(temporizador);
        }

        // Nunca dejar la interfaz bloqueada.
        bloquearControles(false);

        // Restaurar estado si todavía estaba cargando.
        if (estadoActual === "cargando") {

            actualizarEstado(
                "listo",
                "Listo para el próximo mensaje"
            );

        }

        campoMensaje.focus();

    }

}


/* ==================================================
   11. INICIAR APLICACIÓN
================================================== */

function iniciarFutapp() {

    // Comprobar que los elementos HTML existan.
    if (
        !formulario ||
        !campoMensaje ||
        !botonEnviar ||
        !chatMensajes ||
        !estadoChat ||
        !contador
    ) {

        console.error(
            "Futapp: No se encontraron todos los elementos HTML."
        );

        return;
    }

    // Registrar el evento de envío.
    formulario.addEventListener(
        "submit",
        enviarMensaje
    );

    // Inicializar contador.
    actualizarContador();

    // Verificar configuración.
    const webhook = obtenerWebhookUrl();

    if (!webhook) {

        actualizarEstado(
            "error",
            "Configuración pendiente: revisá config.js"
        );

        console.error(
            "Futapp: WEBHOOK_URL no está disponible o no está configurado."
        );

    } else {

        actualizarEstado(
            "listo",
            "Listo para jugar ⚽"
        );

        console.log(
            "Futapp: configuración del webhook detectada correctamente."
        );

    }

}


// Ejecutar cuando el documento esté listo.
if (document.readyState === "loading") {

    document.addEventListener(
        "DOMContentLoaded",
        iniciarFutapp
    );

} else {

    iniciarFutapp();

}


/* ==================================================
   FIN DEL SCRIPT FUTAPP
================================================== */
