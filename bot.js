require('dotenv').config(); 

const { Telegraf } = require('telegraf');
const express = require('express');
const db = require('./database.js');
const registerHandlers = require('./handlers.js');

const PORT = process.env.PORT || 3000;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID; // 1. Lee el ID
const TOKEN = process.env.TOKEN;
const URL = process.env.URL;

// Validar que las variables existan
if (!ADMIN_USER_ID || !TOKEN || !URL) {
  console.error("¡ERROR! Faltan variables de entorno. Revisa ADMIN_USER_ID, TOKEN, y URL.");
  process.exit(1); // Detiene el bot si faltan
}

const bot = new Telegraf(TOKEN);

// Usamos parte del token para crear una ruta secreta y segura
const RUTA_SECRETA = `/telegraf/${bot.token}`;

// ============================================
// --- ¡¡EL FIREWALL!! (Paso que faltaba) ---
// ============================================
//
// Esto se ejecuta ANTES que registerHandlers.
// Revisa CADA mensaje, botón o comando.
//
bot.use((ctx, next) => {
  // 2. Compara el ID del mensaje con tu ID
  if (ctx.from && ctx.from.id && String(ctx.from.id) === String(ADMIN_USER_ID)) {
    // Si el ID coincide con el tuyo, deja que el bot continúe
    // procesando el comando (pasa a registerHandlers).
    return next();
  } else {
    // Si el ID NO coincide, detiene todo y responde.
    // Opcional: puedes quitar el .reply() para que el bot
    // simplemente ignore a los extraños en silencio.
    console.warn(`Bloqueado: Intento de acceso de ID ${ctx.from ? ctx.from.id : 'desconocido'}`);
    return ctx.reply('🔒 Lo siento, este es un bot privado.');
  }
});

// ============================================
// INICIAR BOT Y SERVIDOR
// ============================================

const app = express();
app.use(express.json()); 

// 3. Registrar handlers (SÓLO se ejecuta si el firewall pasa)
registerHandlers(bot);

app.use(bot.webhookCallback(RUTA_SECRETA));

bot.telegram.setWebhook(`${URL}${RUTA_SECRETA}`);

// 6. Iniciar el servidor Express
app.listen(PORT, () => {
  console.log(`🤖 ¡Bot del Súper (con Webhook y Firewall) iniciado!`);
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  console.log(`Ruta del Webhook: ${RUTA_SECRETA}`);
  console.log(`✅ ¡Seguridad activada! Solo el usuario ${ADMIN_USER_ID} puede usarlo.`);
});

// 7. Manejo de errores
bot.catch((err, ctx) => {
  console.error('Error en el bot:', err);
  // Solo te responde el error a ti
  if (ctx.from && String(ctx.from.id) === String(ADMIN_USER_ID)) {
    ctx.reply('❌ Ocurrió un error inesperado. Revisa la consola.');
  }
});

// 8. Manejo de cierre graceful (no cambia)
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  db.close((err) => {
    if (err) return console.error(err.message);
    console.log('Conexión de base de datos cerrada.');
  });
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  db.close((err) => {
    if (err) return console.error(err.message);
    console.log('Conexión de base de datos cerrada.');
  });
});