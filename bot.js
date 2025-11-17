// Archivo: bot.js

// Archivo: bot.js (Versión para Webhook)

const { Telegraf } = require('telegraf');
const express = require('express'); // ¡Importamos Express!
const db = require('./database.js');
const registerHandlers = require('./handlers.js');

// ============================================
// --- ¡¡CONFIGURACIÓN DE DESPLIEGUE!! ---
// ============================================

// ¡¡DEBES REEMPLAZAR ESTOS VALORES!!
const PORT = process.env.PORT || 3000;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID;
const TOKEN = process.env.TOKEN;
const URL = process.env.URL;


const bot = new Telegraf(TOKEN);

// Usamos parte del token para crear una ruta secreta y segura
const RUTA_SECRETA = `/telegraf/${bot.token}`;

// ============================================
// INICIAR BOT Y SERVIDOR
// ============================================

// 1. Crear la instancia del bot PRIMERO

// 2. Crear la instancia del servidor Express
const app = express();
app.use(express.json()); // Middleware para que Telegraf procese los JSON de Telegram

// 3. Registrar todos los "handlers" (comandos, etc.)
// ¡Esto no cambia! La lógica está separada.
registerHandlers(bot);

// 4. Conectar Telegraf con Express en la ruta secreta
// Express escuchará en esta ruta, y Telegraf procesará los mensajes
app.use(bot.webhookCallback(RUTA_SECRETA));

// 5. Decirle a Telegram DÓNDE está nuestro Webhook
// Esto se ejecuta CADA VEZ que el servidor arranca,
// asegurando que Telegram siempre sepa la URL correcta.
bot.telegram.setWebhook(`${URL}${RUTA_SECRETA}`);

// 6. Iniciar el servidor Express
app.listen(PORT, () => {
  console.log(`🤖 ¡Bot del Súper (con Webhook) iniciado!`);
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  console.log(`Ruta del Webhook: ${RUTA_SECRETA}`);
});

// 7. Manejo de errores (no cambia)
bot.catch((err, ctx) => {
  console.error('Error en el bot:', err);
  ctx.reply('❌ Ocurrió un error inesperado. Intenta de nuevo.');
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