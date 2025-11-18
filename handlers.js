const { Markup } = require('telegraf');
const db = require('./database.js');

// --- CEREBRO PARSER ---
function parseLine(line) {
  line = line.trim();
  const ultimoEspacio = line.lastIndexOf(' ');
  if (ultimoEspacio === -1) {
    return { error: `Formato inválido (sin precio): \`${line}\`` };
  }
  const precioStr = line.substring(ultimoEspacio + 1).trim();
  const precio = parseFloat(precioStr);
  if (isNaN(precio) || precio <= 0) {
    return { error: `Precio inválido: \`${line}\`` };
  }
  let textoRestante = line.substring(0, ultimoEspacio).trim();
  const primerEspacio = textoRestante.indexOf(' ');
  let cantidad = 1;
  let producto = "";
  if (primerEspacio === -1) {
    const soloNum = parseInt(textoRestante);
    if (!isNaN(soloNum) && soloNum > 0) {
      return { error: `Producto vacío: \`${line}\`` };
    }
    producto = textoRestante;
  } else {
    const posibleCantidadStr = textoRestante.substring(0, primerEspacio).trim();
    const posibleCantidad = parseInt(posibleCantidadStr);
    if (!isNaN(posibleCantidad) && posibleCantidad > 0) {
      cantidad = posibleCantidad;
      producto = textoRestante.substring(primerEspacio + 1).trim();
    } else {
      cantidad = 1;
      producto = textoRestante;
    }
  }
  if (producto.length === 0) {
    return { error: `Producto vacío: \`${line}\`` };
  }
  return { producto, precio, cantidad };
}

// --- FUNCIÓN HELPER PARA "TACHAR" DE LA LISTA ---
function checkOffList(productoComprado) {
  const sql = `DELETE FROM lista_mandado 
               WHERE LOWER(?) LIKE '%' || LOWER(producto) || '%'`;
  db.run(sql, [productoComprado], (err) => {
    if (err) {
      console.error("Error al tachar de lista_mandado:", err.message);
    }
  });
}

// --- FUNCIÓN DE UNA SOLA LÍNEA ---
async function handleSingleLine(ctx, texto) {
  const result = parseLine(texto);
  if (result.error) {
    ctx.reply(`❌ ${result.error}`);
    return;
  }

  const { producto, precio, cantidad } = result;
  const fecha = new Date().toISOString();
  const sql_insert = `INSERT INTO compras (fecha, producto, precio) VALUES (?, ?, ?)`;
  
  checkOffList(producto);

  let successCount = 0;
  let lastID = null;

  for (let i = 0; i < cantidad; i++) {
    await new Promise((resolve) => {
      db.run(sql_insert, [fecha, producto, precio], function(err) {
        if (!err) {
          successCount++;
          lastID = this.lastID;
        }
        resolve();
      });
    });
  }

  if (successCount === 0) {
    return ctx.reply('❌ Error al guardar en la base de datos.');
  }
  
  const sql_total = `SELECT SUM(precio) as total, COUNT(*) as cantidad 
                       FROM compras 
                       WHERE DATE(fecha) = DATE('now', 'localtime')`;
                       
  db.get(sql_total, [], (err, row) => {
    if (err) {
      console.error(err.message);
    }
    const total = (row && row.total) || 0;
    const cantidadHoy = (row && row.cantidad) || 0;
    const mensaje = `
✅ *Añadido:* ${cantidad} x ${producto}
(c/u $${precio.toFixed(2)}, total $${(cantidad * precio).toFixed(2)})

📊 *Total de HOY:*
💰 Total: $${total.toFixed(2)}
🛍️ Productos: ${cantidadHoy}
    `;
    if (cantidad === 1) {
        ctx.replyWithMarkdown(mensaje,
          Markup.inlineKeyboard([
            [Markup.button.callback('🗑️ Eliminar este item', `eliminar_${lastID}`)],
            [Markup.button.callback('📋 Ver resumen hoy', 'ver_hoy')]
          ])
        );
    } else {
        ctx.replyWithMarkdown(mensaje,
          Markup.inlineKeyboard([
            [Markup.button.callback('📋 Ver resumen hoy', 'ver_hoy')]
          ])
        );
    }
  });
}

// --- FUNCIÓN DE MÚLTIPLES LÍNEAS ---
async function handleMultiLine(ctx, lines) {
  ctx.reply(`Procesando ${lines.length} líneas... ⏳`);
  
  let productosGuardados = 0;
  let totalGastado = 0;
  let lineasFallidas = [];
  const fecha = new Date().toISOString();
  
  const linePromises = lines.map(line => {
    const result = parseLine(line);
    
    if (result.error) {
      lineasFallidas.push(line);
      return Promise.resolve();
    }
    
    const { producto, precio, cantidad } = result;

    checkOffList(producto);
    
    let insertPromises = [];
    for (let i = 0; i < cantidad; i++) {
      insertPromises.push(new Promise((resolve) => {
        const sql = `INSERT INTO compras (fecha, producto, precio) VALUES (?, ?, ?)`;
        db.run(sql, [fecha, producto, precio], (err) => {
          if (!err) {
            productosGuardados++;
            totalGastado += precio;
          }
          resolve(); 
        });
      }));
    }
    return Promise.all(insertPromises);
  });
  
  await Promise.all(linePromises);
  
  let mensajeResumen = `
*--- Resumen de Importación ---*

✅ *Items guardados:* ${productosGuardados}
💰 *Total añadido:* $${totalGastado.toFixed(2)}
  `;
  
  if (lineasFallidas.length > 0) {
    mensajeResumen += `
⚠️ *No pude entender estas ${lineasFallidas.length} líneas:*
${lineasFallidas.map(l => ` - \`${l}\``).join('\n')}
    `;
  }
  ctx.replyWithMarkdown(mensajeResumen);
}

// ============================================
// REGISTRO DE HANDLERS (ÚNICO)
// ============================================

module.exports = (bot) => {

  bot.start((ctx) => {
    const mensaje = `
🛒 *¡Bienvenido al Bot del Súper!*

*NUEVO: Lista de Mandado*
1. Añade items con \`/mandado Leche Pan\`
2. Compra normal \`Leche 30\` (se tacha solo)
3. Revisa qué falta con \`/faltan\`

*Comandos principales:*
    `/ayuda` - Ver todos los comandos
    `/totalhoy` - Total gastado hoy
    `/top` - Productos más comprados
    `;
    ctx.replyWithMarkdown(mensaje);
  });

  bot.command('ayuda', (ctx) => {
    const mensaje = `
📋 *Lista de Comandos:*

*🛒 Lista de Mandado:*
- \`/mandado [Item1] [Item2]...\` - Añade items a la lista.
- \`/mandado\` (con varias líneas) - Añade una lista.
- \`/faltan\` - Muestra items pendientes de la lista.
- \`/limpiarlista\` - Borra toda la lista del mandado.

*💰 Registro de Compras:*
- \`Leche 28\` (1 item)
- \`3 Leche 28\` (3 items)
- (Pega una lista de varias líneas)

*📊 Consultas:*
- /totalhoy - Total gastado hoy
- /semana - Gastos de los últimos 7 días
- /mes - Gastos del último mes
- /top [número] - Top productos (ej: /top 10)
- /buscar [producto] - Buscar producto

*⚙️ Gestión:*
- /exportar - Exportar a CSV
    `;
    ctx.replyWithMarkdown(mensaje);
  });

  bot.command('mandado', (ctx) => {
    const texto = ctx.message.text.replace('/mandado', '').trim();
    if (!texto) {
      return ctx.reply('Uso: /mandado [Producto 1] [Producto 2]...\n(O envía /mandado seguido de una lista en varias líneas)');
    }

    const productos = texto.split(/\s+|\n+/).filter(p => p.trim().length > 0);
    
    if (productos.length === 0) {
      return ctx.reply('No encontré productos para añadir. Uso: /mandado Leche Pan');
    }

    const sql = `INSERT OR IGNORE INTO lista_mandado (producto) VALUES (?)`;
    let addedCount = 0;

    const promises = productos.map(producto => {
      return new Promise(resolve => {
        const prodCapitalizado = producto.charAt(0).toUpperCase() + producto.slice(1).toLowerCase();
        db.run(sql, [prodCapitalizado], function(err) {
          if (!err && this.changes > 0) {
            addedCount++;
          }
          resolve();
        });
      });
    });

    Promise.all(promises).then(() => {
      ctx.reply(`✅ Añadidos ${addedCount} productos nuevos a la lista del mandado.`);
    });
  });

  bot.command('faltan', (ctx) => {
    db.all(`SELECT producto FROM lista_mandado ORDER BY producto ASC`, [], (err, rows) => {
      if (err) {
        console.error(err.message);
        return ctx.reply('❌ Error al consultar la lista.');
      }
      if (rows.length === 0) {
        return ctx.replyWithMarkdown('✅ *¡Todo bien! No te falta nada de la lista.*');
      }
      
      const lista = rows.map(r => `• ${r.producto}`).join('\n');
      ctx.replyWithMarkdown(`*--- 🛒 Faltan por Comprar ---*\n${lista}`);
    });
  });

  bot.command('limpiarlista', (ctx) => {
    db.run(`DELETE FROM lista_mandado`, [], function(err) {
      if (err) {
        console.error(err.message);
        return ctx.reply('❌ Error al limpiar la lista.');
      }
      ctx.reply(`✅ Lista del mandado eliminada. ¡Todo limpio!`);
    });
  });

  bot.on('text', async (ctx) => {
    const texto = ctx.message.text;
    if (texto.startsWith('/')) return;
    const lines = texto.split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) return;
    if (lines.length === 1) {
      await handleSingleLine(ctx, lines[0]);
    } else {
      await handleMultiLine(ctx, lines);
    }
  });

  bot.command('totalhoy', (ctx) => {
    const sql = `SELECT SUM(precio) as total, COUNT(*) as cantidad 
                   FROM compras 
                   WHERE DATE(fecha) = DATE('now', 'localtime')`;
    db.get(sql, [], (err, row) => {
      if (err) return ctx.reply('❌ Error al consultar.');
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
      if (err) return ctx.reply('❌ Error al consultar.');
      if (rows.length === 0) return ctx.reply('📭 No hay compras en los últimos 7 días.');
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
      if (err) return ctx.reply('❌ Error al consultar.');
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
      if (err) return ctx.reply('❌ Error al consultar.');
      if (rows.length === 0) return ctx.reply('📭 No hay productos registrados.');
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
    if (!termino) return ctx.reply('❌ Uso: `/buscar leche`');
    const sql = `SELECT fecha, producto, precio 
                   FROM compras 
                   WHERE LOWER(producto) LIKE LOWER(?)
                   ORDER BY fecha DESC
                   LIMIT 20`;
    db.all(sql, [`%${termino}%`], (err, rows) => {
      if (err) return ctx.reply('❌ Error al buscar.');
      if (rows.length === 0) return ctx.reply(`📭 No se encontraron resultados para: *${termino}*`);
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
      if (err) return ctx.reply('❌ Error al exportar.');
      if (rows.length === 0) return ctx.reply('📭 No hay datos para exportar.');
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

  bot.action(/ver_hoy/, (ctx) => {
    ctx.answerCbQuery();
    ctx.reply('Aquí tienes el total de hoy:');
    ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    const sql = `SELECT SUM(precio) as total, COUNT(*) as cantidad 
                   FROM compras 
                   WHERE DATE(fecha) = DATE('now', 'localtime')`;
    db.get(sql, [], (err, row) => {
      if (err) return ctx.reply('❌ Error al consultar.');
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
      if (err) return ctx.answerCbQuery('❌ Error al eliminar');
      ctx.answerCbQuery('✅ Eliminado');
      ctx.editMessageText(`✅ Compra eliminada (ID: ${id})`);
    });
  });

};