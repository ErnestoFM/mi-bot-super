const { Markup } = require('telegraf');
const db = require('./database.js');

// --- nueva función: tacha items comprados de la lista_mandado ---
function checkOffList(productoComprado) {
  // Esta lógica borra "Leche" de la lista si compraste "Leche Deslactosada"
  // pero no borrará "Leche Deslactosada" si solo compraste "Leche".
  const sql = `DELETE FROM lista_mandado 
               WHERE LOWER(?) LIKE '%' || LOWER(producto) || '%'`;
  db.run(sql, [productoComprado], (err) => {
    if (err) {
      console.error("Error al tachar de lista_mandado:", err.message);
    }
  });
}

// ============================================
// --- ¡EL NUEVO CEREBRO! (Parser) ---
// ============================================
/**
 * Analiza una línea de texto para encontrar cantidad, producto y precio.
 * Formatos aceptados:
 * - "Producto 10" (Cantidad 1, Producto "Producto", Precio 10)
 * - "3 Producto 10" (Cantidad 3, Producto "Producto", Precio 10)
 * - "3 Producto con espacios 10" (Cantidad 3, Producto "Producto con espacios", Precio 10)
 * @param {string} line - La línea de texto a analizar.
 * @returns {object} - Un objeto con {producto, precio, cantidad} o {error}
 */
function parseLine(line) {
  line = line.trim();
  
  // 1. Encontrar el precio (sigue siendo el último número)
  const ultimoEspacio = line.lastIndexOf(' ');
  if (ultimoEspacio === -1) {
    return { error: `Formato inválido (sin precio): \`${line}\`` };
  }
  
  const precioStr = line.substring(ultimoEspacio + 1).trim();
  const precio = parseFloat(precioStr);
  
  if (isNaN(precio) || precio <= 0) {
    return { error: `Precio inválido: \`${line}\`` };
  }
  
  let textoRestante = line.substring(0, ultimoEspacio).trim(); // "3 salsa de tomate" o "salsa de tomate"
  
  // 2. Encontrar la cantidad (el primer número)
  const primerEspacio = textoRestante.indexOf(' ');
  let cantidad = 1;
  let producto = "";
  
  if (primerEspacio === -1) {
    // No hay espacios, solo queda una palabra. Ej: "Leche"
    // Validamos si es un número (caso: "3 15", que es inválido)
    const soloNum = parseInt(textoRestante);
    if (!isNaN(soloNum) && soloNum > 0) {
      return { error: `Producto vacío: \`${line}\`` };
    }
    producto = textoRestante;
    
  } else {
    // Hay espacios. Ej: "3 salsa de tomate" o "salsa de tomate"
    const posibleCantidadStr = textoRestante.substring(0, primerEspacio).trim();
    const posibleCantidad = parseInt(posibleCantidadStr);
    
    // Si la primera palabra es un número, tómala como cantidad
    if (!isNaN(posibleCantidad) && posibleCantidad > 0) {
      cantidad = posibleCantidad;
      producto = textoRestante.substring(primerEspacio + 1).trim();
    } else {
      // Si no, todo el texto es el producto
      cantidad = 1;
      producto = textoRestante;
    }
  }
  
  // 3. Verificación final
  if (producto.length === 0) {
    return { error: `Producto vacío: \`${line}\`` };
  }
  
  return { producto, precio, cantidad };
}


// --- FUNCIÓN DE UNA SOLA LÍNEA (ACTUALIZADA) ---
// Ahora usa el parser y maneja la cantidad
async function handleSingleLine(ctx, texto) {
  const result = parseLine(texto);

  if (result.error) {
    ctx.reply(`❌ ${result.error}`);
    return;
  }

  const { producto, precio, cantidad } = result;
  const fecha = new Date().toISOString();
  const sql_insert = `INSERT INTO compras (fecha, producto, precio) VALUES (?, ?, ?)`;
  
  let successCount = 0;
  let lastID = null;

  // Hacemos un loop para insertar la cantidad de veces
  for (let i = 0; i < cantidad; i++) {
    await new Promise((resolve) => {
      db.run(sql_insert, [fecha, producto, precio], function(err) {
        if (!err) {
          successCount++;
          lastID = this.lastID; // Guarda el ID del *último* item insertado
        }
        resolve();
      });
    });
  }

  if (successCount === 0) {
    return ctx.reply('❌ Error al guardar en la base de datos.');
  }
  
  // Lógica de "Total Hoy"
  const sql_total = `SELECT SUM(precio) as total, COUNT(*) as cantidad 
                       FROM compras 
                       WHERE DATE(fecha) = DATE('now', 'localtime')`;
                       
  db.get(sql_total, [], (err, row) => {
    if (err) {
      console.error(err.message);
      //... (manejo de error)
    }
    
    const total = (row && row.total) || 0;
    const cantidadHoy = (row && row.cantidad) || 0;
    
    // Mensaje de respuesta mejorado
    const mensaje = `
✅ *Añadido:* ${cantidad} x ${producto}
(c/u $${precio.toFixed(2)}, total $${(cantidad * precio).toFixed(2)})

📊 *Total de HOY:*
💰 Total: $${total.toFixed(2)}
🛍️ Productos: ${cantidadHoy}
    `;
    
    // IMPORTANTE: Solo mostramos el botón "Eliminar" si fue 1 solo item.
    // Si fueron varios, sería confuso (solo borraría el último).
    if (cantidad === 1) {
        ctx.replyWithMarkdown(mensaje,
          Markup.inlineKeyboard([
            [Markup.button.callback('🗑️ Eliminar este item', `eliminar_${lastID}`)],
            [Markup.button.callback('📋 Ver resumen hoy', 'ver_hoy')]
          ])
        );
    } else {
        // Sin botón de eliminar si son varios items
        ctx.replyWithMarkdown(mensaje,
          Markup.inlineKeyboard([
            [Markup.button.callback('📋 Ver resumen hoy', 'ver_hoy')]
          ])
        );
    }
  });
}

// --- FUNCIÓN DE MÚLTIPLES LÍNEAS (ACTUALIZADA) ---
// Ahora también usa el parser
async function handleMultiLine(ctx, lines) {
  ctx.reply(`Procesando ${lines.length} líneas... ⏳`);
  
  let productosGuardados = 0; // Conteo de items (3 leches = 3 items)
  let totalGastado = 0;
  let lineasFallidas = [];
  const fecha = new Date().toISOString();
  
  const linePromises = lines.map(line => {
    const result = parseLine(line); // Usa el nuevo parser
    
    if (result.error) {
      lineasFallidas.push(line);
      return Promise.resolve(); // Resuelve promesa vacía
    }
    
    const { producto, precio, cantidad } = result;
    
    // Loop interno para la cantidad
    let insertPromises = [];
    for (let i = 0; i < cantidad; i++) {
      insertPromises.push(new Promise((resolve) => {
        const sql = `INSERT INTO compras (fecha, producto, precio) VALUES (?, ?, ?)`;
        db.run(sql, [fecha, producto, precio], (err) => {
          if (err) {
            // No se pudo guardar este item, pero no rompemos todo
          } else {
            productosGuardados++;
            totalGastado += precio;
          }
          resolve(); 
        });
      }));
    }
    // Espera a que se guarden todos los items de esta línea (ej. las 3 leches)
    return Promise.all(insertPromises);
  });
  
  // Espera a que se procesen TODAS las líneas
  await Promise.all(linePromises);
  
  // Construye el mensaje de resumen
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
// REGISTRO DE HANDLERS
// ============================================

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
- Consultar estadísticas

*Formatos para agregar:*
- \`Producto Precio\`
- \`Cantidad Producto Precio\`
- (O pega una lista de varias líneas)
    `;
    ctx.replyWithMarkdown(mensaje);
  });

  bot.command('ayuda', (ctx) => {
    const mensaje = `
📋 *Lista de Comandos:*

*Registro de compras:*
- \`Leche 28\` (1 item)
- \`3 Leche 28\` (3 items)
- O pega una lista de varias líneas.

*Consultas:*
- /totalhoy - Total gastado hoy
- /semana - Gastos de los últimos 7 días
- /mes - Gastos del último mes
- /top [número] - Top productos (ej: /top 10)
- /buscar [producto] - Buscar producto

*Gestión:*
- /exportar - Exportar a CSV
    `;
    ctx.replyWithMarkdown(mensaje);
  });

  // ============================================
  // MANEJO DE TEXTO (ACTUALIZADO)
  // ============================================
  bot.on('text', async (ctx) => {
    const texto = ctx.message.text;
    if (texto.startsWith('/')) return;

    // Filtra líneas vacías
    const lines = texto.split('\n').filter(line => line.trim().length > 0);

    if (lines.length === 0) return; // No hacer nada si está vacío

    if (lines.length === 1) {
      // Si es solo 1 línea
      await handleSingleLine(ctx, lines[0]);
    } else {
      // Si son varias líneas
      await handleMultiLine(ctx, lines);
    }
  });

  // ============================================
  // COMANDOS DE CONSULTA (Sin cambios)
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
  // BOTONES INLINE (CALLBACKS) (Sin cambios)
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

module.exports = (bot) => {

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

bot.on('text', async (ctx) => {
  const texto = ctx.message.text;
  if (texto.startsWith('/')) return;
  const lines = texto.split('\n').filter(line => line.trim().length > 0);
  
  if (lines.length === 1) {
    // Si es solo 1 línea, usa la lógica vieja (Producto Precio)
    await handleSingleLine(ctx, lines[0]);
  } else {
    // Si son varias líneas, usa la lógica nueva (Producto - Precio)
    await handleMultiLine(ctx, lines);
  }
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