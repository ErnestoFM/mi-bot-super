const { Pool } = require('pg');

// Render nos da la URL completa en una variable de entorno
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Requerido para conexiones seguras en Render
  }
});

// Función para 
//  las tablas si no existen
const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS compras (
        id SERIAL PRIMARY KEY,
        fecha TIMESTAMPTZ NOT NULL,
        producto TEXT NOT NULL,
        precio DECIMAL(10,2) NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS lista_mandado (
        id SERIAL PRIMARY KEY,
        producto TEXT NOT NULL UNIQUE
      );
    `);
    console.log("Tablas verificadas en PostgreSQL");
  } catch (err) {
    console.error("Error inicializando DB:", err);
  } finally {
    client.release();
  }
};

initDB();

// Adaptamos el objeto db para que use comandos similares a sqlite3 en tus handlers
module.exports = {
  // Para INSERT/DELETE
  run: (sql, params, callback) => {
    // Convertimos los "?" de SQLite a "$1, $2" de Postgres
    let pgSql = sql;
    params.forEach((_, i) => { pgSql = pgSql.replace('?', `$${i + 1}`); });

    pool.query(pgSql, params)
      .then(res => callback && callback.call({ lastID: res.oid, changes: res.rowCount }, null))
      .catch(err => callback && callback(err));
  },
  // Para SELECT de una fila
  get: (sql, params, callback) => {
    let pgSql = sql;
    params.forEach((_, i) => { pgSql = pgSql.replace('?', `$${i + 1}`); });

    pool.query(pgSql, params)
      .then(res => callback(null, res.rows[0]))
      .catch(err => callback(err));
  },
  // Para SELECT de varias filas
  all: (sql, params, callback) => {
    let pgSql = sql;
    params.forEach((_, i) => { pgSql = pgSql.replace('?', `$${i + 1}`); });

    pool.query(pgSql, params)
      .then(res => callback(null, res.rows))
      .catch(err => callback(err));
  }
};