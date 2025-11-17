const { Markup } = require('telegraf');
const db = require('./database.js');

module.exports = (bot) => {

  // ============================================
  // COMANDOS PRINCIPALES
  // ============================================

  bot.start((ctx) => {
    const mensaje = `
🛒 *¡Bienvenido al Bot del Súper!*

Puedo ayudarte a:
- Registrar tus compras del día
- Ver el total de hoy
- Consultar estadísticas semanales/mensuales

*Comandos disponibles:*
/ayuda - Ver todos los comandos
/totalhoy - Total gastado hoy
/semana - Resumen de la semana
/mes - Resumen del mes
/top - Productos más comprados
/exportar - Exportar datos

*Formato para agregar productos:*
\`Producto Precio\`
Ejemplo: \`Leche 28\`
    `;
    ctx.replyWithMarkdown(mensaje);
  });

  bot.command('ayuda', (ctx) => {
    const mensaje = `
📋 *Lista de Comandos:*

*Registro de compras:*
- Envía: \`Producto Precio\` (ej: Leche 28)

*Consultas:*
- /totalhoy - Total gastado hoy
- /semana - Gastos de los últimos 7 días
- /mes - Gastos del último mes
- /top [número] - Top productos (ej: /top 10)
- /buscar [producto] - Buscar producto

*Gestión:*
- /exportar - Exportar a CSV

*(Más comandos próximamente)*
    `;
    ctx.replyWithMarkdown(mensaje);
  });


// ============================================
// MANEJO DE TEXTO (AGREGAR PRODUCTOS)
// ============================================

bot.on('text', (ctx) => {
    const texto = ctx.message.text;
    if (texto.startsWith('/')) return;

    const ultimoEspacio = texto.lastIndexOf(' ');
    if (ultimoEspacio === -1 || ultimoEspacio === 0) {
      ctx.reply('❌ Formato incorrecto.\n\nUsa: `Producto Precio`\nEjemplo: `Leche 28`', { parse_mode: 'Markdown' });
      return;
    }
    const producto = texto.substring(0, ultimoEspacio).trim();
    const precio = parseFloat(texto.substring(ultimoEspacio + 1));
    if (isNaN(precio) || precio <= 0) {
      ctx.reply('❌ El precio debe ser un número válido mayor a 0.');
      return;
    }

    const fecha = new Date().toISOString();
    const sql_insert = `INSERT INTO compras (fecha, producto, precio) VALUES (?, ?, ?)`;

    db.run(sql_insert, [fecha, producto, precio], function(err) {
      if (err) {
        console.error(err.message);
        ctx.reply('❌ Error al guardar en la base de datos.');
        return;
      }
      
      const nuevoID = this.lastID;
      const sql_total = `SELECT SUM(precio) as total, COUNT(*) as cantidad 
                           FROM compras 
                           WHERE DATE(fecha) = DATE('now', 'localtime')`;
                           
      db.get(sql_total, [], (err, row) => {
        if (err) {
          ctx.replyWithMarkdown(`✅ *Añadido:* ${producto} - $${precio.toFixed(2)} (ID: ${nuevoID})\n\n(Error al calcular el total de hoy)`);
          return;
        }
        
        const total = row.total || 0;
        const cantidad = row.cantidad || 0;
        
        const mensaje = `
✅ *Añadido:* ${producto} - $${precio.toFixed(2)} (ID: ${nuevoID})

📊 *Total de HOY:*
💰 Total: $${total.toFixed(2)}
🛍️ Productos: ${cantidad}
        `;
        
        ctx.replyWithMarkdown(mensaje,
          Markup.inlineKeyboard([
            [Markup.button.callback('🗑️ Eliminar este item', `eliminar_${nuevoID}`)],
            [Markup.button.callback('📋 Ver resumen hoy', 'ver_hoy')]
          ])
        );
      });
    });
  });

  // ============================================
  // COMANDOS DE CONSULTA
  // ============================================

  bot.command('totalhoy', (ctx) => {
    const sql = `SELECT SUM(precio) as total, COUNT(*) as cantidad 
                   FROM compras 
                   WHERE DATE(fecha) = DATE('now', 'localtime')`;
    
    db.get(sql, [], (err, row) => {
      if (err) {
        console.error(err.message);
        ctx.reply('❌ Error al consultar la base de datos.');
        return;
      }
      
      const total = row.total || 0;
      const cantidad = row.cantidad || 0;
      const mensaje = `
📅 *Compras de Hoy*
${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

💰 *Total gastado:* $${total.toFixed(2)}
🛍️ *Productos comprados:* ${cantidad}
📊 *Promedio por producto:* $${cantidad > 0 ? (total / cantidad).toFixed(2) : '0.00'}
      `;
      ctx.replyWithMarkdown(mensaje);
    });
  });

  bot.command('semana', (ctx) => {
    const sql = `SELECT DATE(fecha) as dia, SUM(precio) as total, COUNT(*) as cantidad 
                   FROM compras 
                   WHERE fecha >= datetime('now', '-7 days')
                   GROUP BY DATE(fecha)
                   ORDER BY fecha DESC`;
    
    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error(err.message);
        ctx.reply('❌ Error al consultar la base de datos.');
        return;
      }
      if (rows.length === 0) {
        ctx.reply('📭 No hay compras registradas en los últimos 7 días.');
        return;
      }
      let totalSemana = 0;
      let mensaje = '📊 *Resumen Semanal* (últimos 7 días)\n\n';
      rows.forEach(row => {
        totalSemana += row.total;
        const fechaParts = row.dia.split('-');
        const fecha = new Date(fechaParts[0], fechaParts[1] - 1, fechaParts[2]);
        const fechaStr = fecha.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
        mensaje += `📅 ${fechaStr}: $${row.total.toFixed(2)} (${row.cantidad} productos)\n`;
      });
      mensaje += `\n💰 *Total semanal:* $${totalSemana.toFixed(2)}`;
      mensaje += `\n📊 *Promedio diario:* $${(totalSemana / rows.length).toFixed(2)}`;
      ctx.replyWithMarkdown(mensaje);
    });
  });

  bot.command('mes', (ctx) => {
    const sql = `SELECT SUM(precio) as total, COUNT(*) as cantidad,
                   COUNT(DISTINCT DATE(fecha)) as dias
                   FROM compras 
                   WHERE fecha >= datetime('now', '-30 days')`;
    
    db.get(sql, [], (err, row) => {
      if (err) {
        console.error(err.message);
        ctx.reply('❌ Error al consultar la base de datos.');
        return;
      }
      const total = row.total || 0;
      const cantidad = row.cantidad || 0;
      const dias = row.dias || 0;
      const mensaje = `
📊 *Resumen Mensual* (últimos 30 días)

💰 *Total gastado:* $${total.toFixed(2)}
🛍️ *Productos comprados:* ${cantidad}
📅 *Días con compras:* ${dias}
📊 *Promedio diario:* $${dias > 0 ? (total / dias).toFixed(2) : '0.00'}
🛒 *Promedio por compra:* $${cantidad > 0 ? (total / cantidad).toFixed(2) : '0.00'}
      `;
      ctx.replyWithMarkdown(mensaje);
    });
  });

  bot.command('top', (ctx) => {
    const limite = parseInt(ctx.message.text.split(' ')[1]) || 10;
    
    const sql = `SELECT producto, COUNT(*) as veces, SUM(precio) as total_gastado,
                   AVG(precio) as precio_promedio
                   FROM compras 
                   GROUP BY LOWER(producto)
                   ORDER BY veces DESC
                   LIMIT ?`;
    
    db.all(sql, [limite], (err, rows) => {
      if (err) {
        console.error(err.message);
        ctx.reply('❌ Error al consultar la base de datos.');
        return;
      }
      if (rows.length === 0) {
        ctx.reply('📭 No hay productos registrados.');
        return;
      }
      let mensaje = `🏆 *Top ${limite} Productos Más Comprados*\n\n`;
      rows.forEach((row, index) => {
        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `*${index + 1}.*`;
        mensaje += `${emoji} *${row.producto}*\n`;
        mensaje += `    📦 Comprado ${row.veces} veces\n`;
        mensaje += `    💰 Total: $${row.total_gastado.toFixed(2)}\n`;
        mensaje += `    📊 Promedio: $${row.precio_promedio.toFixed(2)}\n\n`;
      });
      ctx.replyWithMarkdown(mensaje);
    });
  });

  bot.command('buscar', (ctx) => {
    const termino = ctx.message.text.split(' ').slice(1).join(' ');
    
    if (!termino) {
      ctx.reply('❌ Especifica un producto a buscar.\n\nEjemplo: `/buscar leche`', { parse_mode: 'Markdown' });
      return;
    }
    
    const sql = `SELECT fecha, producto, precio 
                   FROM compras 
                   WHERE LOWER(producto) LIKE LOWER(?)
                   ORDER BY fecha DESC
                   LIMIT 20`;
    
    db.all(sql, [`%${termino}%`], (err, rows) => {
      if (err) {
        console.error(err.message);
        ctx.reply('❌ Error al buscar.');
        return;
      }
      if (rows.length === 0) {
        ctx.reply(`📭 No se encontraron resultados para: *${termino}*`, { parse_mode: 'Markdown' });
        return;
      }
      let mensaje = `🔍 *Resultados para:* ${termino}\n\n`;
      rows.forEach(row => {
        const fecha = new Date(row.fecha).toLocaleDateString('es-MX');
        mensaje += `📅 ${fecha}: *${row.producto}* - $${row.precio.toFixed(2)}\n`;
      });
      ctx.replyWithMarkdown(mensaje);
    });
  });

  bot.command('exportar', (ctx) => {
    const sql = `SELECT fecha, producto, precio FROM compras ORDER BY fecha DESC LIMIT 100`;
    
    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error(err.message);
        ctx.reply('❌ Error al exportar datos.');
        return;
      }
      if (rows.length === 0) {
        ctx.reply('📭 No hay datos para exportar.');
        return;
      }
      let csv = 'Fecha,Producto,Precio\n';
      rows.forEach(row => {
        csv += `${row.fecha},"${row.producto}",${row.precio}\n`;
      });
      ctx.replyWithDocument({ 
        source: Buffer.from(csv), 
        filename: `compras_${new Date().toISOString().split('T')[0]}.csv` 
      });
    });
  });

  // ============================================
  // BOTONES INLINE (CALLBACKS)
  // ============================================

  bot.action(/ver_hoy/, (ctx) => {
    ctx.answerCbQuery();
    ctx.reply('Aquí tienes el total de hoy:');
    ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    
    const sql = `SELECT SUM(precio) as total, COUNT(*) as cantidad 
                   FROM compras 
                   WHERE DATE(fecha) = DATE('now', 'localtime')`;
    
    db.get(sql, [], (err, row) => {
      if (err) {
        console.error(err.message);
        ctx.reply('❌ Error al consultar la base de datos.');
        return;
      }
      const total = row.total || 0;
      const cantidad = row.cantidad || 0;
      const mensaje = `
📅 *Compras de Hoy*
${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

💰 *Total gastado:* $${total.toFixed(2)}
🛍️ *Productos comprados:* ${cantidad}
📊 *Promedio por producto:* $${cantidad > 0 ? (total / cantidad).toFixed(2) : '0.00'}
      `;
      ctx.replyWithMarkdown(mensaje);
    });
  });

  bot.action(/eliminar_(\d+)/, (ctx) => {
    const id = ctx.match[1];
    
    db.run('DELETE FROM compras WHERE id = ?', [id], function(err) {
      if (err) {
        ctx.answerCbQuery('❌ Error al eliminar');
        return;
      }
      
      ctx.answerCbQuery('✅ Eliminado');
      ctx.editMessageText(`✅ Compra eliminada (ID: ${id})`);
    });
  });

};