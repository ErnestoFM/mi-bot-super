require('dotenv').config();

const { Telegraf } = require('telegraf');
const express = require('express');
const db = require('./database.js');
const registerHandlers = require('./handlers.js');

const PORT = process.env.PORT || 3000;

// lee la lista de IDs desde ALLOWED_USER_IDS o desde ADMIN_USER_ID (compatibilidad)
const ALLOWED_IDS_STRING = process.env.ALLOWED_USER_IDS || process.env.ADMIN_USER_ID || '';
const ALLOWED_USER_IDS = ALLOWED_IDS_STRING ? ALLOWED_IDS_STRING.split(',').map(id => id.trim()) : [];

const TOKEN = process.env.TOKEN;
const URL = process.env.URL;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || (ALLOWED_USER_IDS.length ? ALLOWED_USER_IDS[0] : null);

// Validar que las variables existan
if (ALLOWED_USER_IDS.length === 0 || !TOKEN || !URL) {
  console.error("¡ERROR! Faltan variables de entorno. Revisa ADMIN_USER_ID (o ALLOWED_USER_IDS), TOKEN y URL.");
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
  const userId = ctx.from ? String(ctx.from.id) : null;

  // Ahora comprueba si el ID del usuario está *en la lista*
  if (userId && ALLOWED_USER_IDS.includes(userId)) {
    return next(); // Si está en la lista, déjalo pasar
  } else {
    // Si no, bloquéalo
    console.warn(`Bloqueado: Intento de acceso de ID ${userId || 'desconocido'}`);
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