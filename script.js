
/* ========================================
   FUTAPP - LÓGICA PRINCIPAL
======================================== */

// Elementos del DOM
const formulario = document.getElementById("zona-de-escritura");
const campoMensaje = document.getElementById("mensaje");
const botonEnviar = document.getElementById("btn-enviar");
const chatMensajes = document.getElementById("chat-messages");
const estadoChat = document.getElementById("chat-status");
const contador = document.getElementById("contador");

// Configuración
const MAX_CARACTERES = 500;
const TIEMPO_MINIMO = 1500;
const TIEMPO_LIMITE = 30000;

let ultimoEnvio = 0;
let estadoActual = "listo";
let sessionIdEnMemoria = null;


/* ========================================
   IDENTIFICADOR DE SESIÓN
======================================== */

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
        // Si localStorage no está disponible, usamos memoria.
        if (!sessionIdEnMemoria) {
            sessionIdEnMemoria = generarSessionId();
        }

        return sessionIdEnMemoria;
    }
}

// Se genera o recupera una sola vez al iniciar.
const sessionId = obtenerSessionId();


/* ========================================
   FUNCIONES VISUALES
======================================== */

// Agregar una burbuja al chat de forma segura.
function agregarMensaje(texto, tipo) {
    const burbuja = document.createElement("div");
    burbuja.classList.add("message", tipo);

    const etiqueta = document.createElement("span");
    etiqueta.classList.add("message-label");

    etiqueta.textContent = tipo === "user"
        ? "Vos"
        : "⚽ Futapp";

    const contenido = document.createElement("div");
    contenido.textContent = texto;

    burbuja.appendChild(etiqueta);
    burbuja.appendChild(contenido);

    chatMensajes.appendChild(burbuja);

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

// Bloquear o habilitar los controles.
function bloquearControles(bloquear) {
    campoMensaje.disabled = bloquear;
    botonEnviar.disabled = bloquear;
}


/* ========================================
   CONTADOR Y VALIDACIÓN
======================================== */

function actualizarContador() {
    const cantidad = campoMensaje.value.length;

    contador.textContent =
        `${cantidad}/${MAX_CARACTERES} caracteres`;
}

campoMensaje.addEventListener("input", actualizarContador);

// Enviar con Enter y permitir saltos de línea con Shift + Enter.
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


/* ========================================
   PAUSA ENTRE ENVÍOS
======================================== */

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


/* ========================================
   PROCESAMIENTO DE LA RESPUESTA
======================================== */

function interpretarRespuesta(texto) {

    // Comprobar si Make respondió vacío.
    if (!texto || !texto.trim()) {
        return "(respuesta vacía)";
    }

    try {
        const datos = JSON.parse(texto);

        // Si la respuesta es un objeto JSON.
        if (
            datos !== null &&
            typeof datos === "object" &&
            !Array.isArray(datos)
        ) {

            // Orden de prioridad de las propiedades.
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

        // JSON válido que no es un objeto.
        return texto;

    } catch (error) {
        // Si no es JSON, mostrar el texto original.
        return texto;
    }
}


/* ========================================
   ENVÍO DEL MENSAJE A MAKE
======================================== */

async function enviarMensaje(event) {

    event.preventDefault();

    const mensaje = campoMensaje.value.trim();

    // Validar que exista un mensaje.
    if (!mensaje) {
        return;
    }

    // Validar longitud máxima.
    if (mensaje.length > MAX_CARACTERES) {
        actualizarEstado(
            "error",
            "El mensaje no puede superar los 500 caracteres."
        );
        return;
    }

    // Mostrar el mensaje del usuario.
    agregarMensaje(mensaje, "user");

    // Limpiar el campo.
    campoMensaje.value = "";
    actualizarContador();

    bloquearControles(true);

    actualizarEstado("cargando", "⚽ Futapp está pensando...");

    try {

        // Comprobar que exista una URL configurada.
        if (
            typeof WEBHOOK_URL === "undefined" ||
            !WEBHOOK_URL.trim() ||
            WEBHOOK_URL.includes("ACA VA")
        ) {

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

        // Respetar la pausa mínima entre envíos consecutivos.
        const tiempoTranscurrido = Date.now() - ultimoEnvio;

        const tiempoEspera = Math.max(
            0,
            TIEMPO_MINIMO - tiempoTranscurrido
        );

        if (tiempoEspera > 0) {
            await esperar(tiempoEspera);
        }

        ultimoEnvio = Date.now();

        // Crear controlador para limitar el tiempo de espera.
        const controlador = new AbortController();

        let tiempoAgotado = false;

        const temporizador = setTimeout(() => {
            tiempoAgotado = true;
            controlador.abort();
        }, TIEMPO_LIMITE);

        try {

            // Enviar únicamente los tres campos requeridos.
            const respuesta = await fetch(WEBHOOK_URL, {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    sessionId: sessionId,
                    mensaje: mensaje,
                    fecha: new Date().toISOString()
                }),

                signal: controlador.signal
            });

            // Leer siempre la respuesta como texto.
            const textoRespuesta = await respuesta.text();

            // Comprobar errores HTTP.
            if (!respuesta.ok) {

                agregarMensaje(
                    `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`,
                    "agent"
                );

                actualizarEstado(
                    "error",
                    "Error en la respuesta del servidor"
                );

                return;
            }

            // Interpretar la respuesta exitosa.
            const mensajeAgente = interpretarRespuesta(
                textoRespuesta
            );

            agregarMensaje(mensajeAgente, "agent");

            // Diferenciar una respuesta sin el campo esperado.
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

        } finally {
            // Liberar siempre el temporizador.
            clearTimeout(temporizador);
        }

    } catch (error) {

        // Diferenciar timeout y fallas de conexión.
        if (error.name === "AbortError") {

            agregarMensaje(
                "La solicitud tardó demasiado. Se agotó el tiempo de espera de 30 segundos. Intentá nuevamente.",
                "agent"
            );

            actualizarEstado(
                "error",
                "Tiempo de espera agotado"
            );

        } else {

            agregarMensaje(
                "No pude conectarme con el servidor. Revisá tu conexión a Internet y la configuración del webhook de Make.",
                "agent"
            );

            actualizarEstado(
                "error",
                "Error de conexión"
            );
        }

    } finally {

        // Garantizar que la interfaz nunca quede bloqueada.
        bloquearControles(false);

        // Restaurar el estado si seguía cargando.
        if (estadoActual === "cargando") {
            actualizarEstado(
                "listo",
                "Listo para el próximo mensaje"
            );
        }

        campoMensaje.focus();
    }
}


/* ========================================
   EVENTOS
======================================== */

formulario.addEventListener("submit", enviarMensaje);

// Estado inicial.
actualizarContador();
actualizarEstado("listo", "Listo para jugar");
