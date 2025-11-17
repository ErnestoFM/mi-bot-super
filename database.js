// Archivo: database.js

const sqlite3 = require('sqlite3').verbose();

// Conexión a la base de datos
const DB_PATH = process.env.DB_PATH || './super.db';

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Conectado a la base de datos SQLite.');
});

// Crea las tablas si no existen
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      producto TEXT NOT NULL,
      precio REAL NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto TEXT NOT NULL UNIQUE,
      categoria TEXT NOT NULL
  )`);
});

// ¡La línea más importante! Exportamos la conexión.
module.exports = db;