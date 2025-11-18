# 🛒 Bot de Súper para Telegram

Un bot personal y privado de Telegram para llevar un registro de los gastos del súper. El bot está construido con Node.js, Telegraf, Express (para Webhooks) y SQLite para la base de datos.

Este proyecto está diseñado para ser desplegado en **Railway** y utiliza almacenamiento de volúmenes persistentes para la base de datos SQLite.

---

## 🤖 Comandos Disponibles

- `/start` - Inicia el bot y muestra el mensaje de bienvenida.
- `/ayuda` - Muestra la lista completa de comandos.
- `/totalhoy` - Muestra el gasto total y el número de productos comprados hoy.
- `/semana` - Muestra un resumen de gastos de los últimos 7 días.
- `/mes` - Muestra un resumen de gastos de los últimos 30 días.
- `/top [limite]` - Muestra los productos más comprados (ej. `/top 5`).
- `/buscar [producto]` - Busca un producto en el historial de compras.
- `/exportar` - Exporta las últimas 100 compras como un archivo `.csv`.

Para registrar un producto, simplemente envía un mensaje con el formato:
`Producto Precio` (Ej: `Leche 28`)

---
## Ejemplo de Funcionlidad
<img width="331" height="269" alt="{EF19E0C0-8F39-45E2-87A2-53D3028CFF1C}" src="https://github.com/user-attachments/assets/b30bb901-6b26-4d22-b8a5-e68d522ebc83" />

## Servidor Corriento con wwebhook en railway integrado con github
<img width="304" height="175" alt="{A2E1049F-79F9-4C27-8E74-6F819ADB1074}" src="https://github.com/user-attachments/assets/7c3b5f9d-f096-4c20-9181-03cfa906e4dc" />

## 🔒 Seguridad

Este bot es **privado**. Utiliza un _middleware_ (firewall) para verificar el ID del usuario en cada mensaje. Solo responderá a las peticiones del usuario definido en la variable de entorno `ADMIN_USER_ID`.

---

## 🚀 Despliegue en Railway

Este proyecto está configurado para desplegarse directamente desde GitHub a Railway.

### 1. Configuración del Volumen (Base de Datos)

Para que tu base de datos `super.db` sea persistente y no se borre en cada reinicio, debes configurar un volumen en Railway:

1.  Ve a la pestaña **"Volumes"** de tu proyecto.
2.  Haz clic en **"Add Volume"**.
3.  En **"Mount Path"**, escribe exactamente: `/data`

El archivo `database.js` está configurado para buscar la base de datos en `/data/super.db` si la variable `DB_PATH` está definida así.

### 2. Variables de Entorno

Ve a la pestaña **"Variables"** de tu proyecto en Railway y configura las siguientes:

| Variable        | Descripción                                                            | Ejemplo                              |
| :-------------- | :--------------------------------------------------------------------- | :----------------------------------- |
| `TOKEN`         | El token secreto de tu bot, obtenido de @BotFather.                    | `123456:ABC...`                      |
| `ADMIN_USER_ID` | Tu ID de usuario numérico de Telegram. El bot solo te responderá a ti. | `987654321`                          |
| `DB_PATH`       | La ruta _dentro del servidor_ para guardar la base de datos.           | `/data/super.db`                     |
| `URL`           | La URL pública que Railway te asigna (de la pestaña "Settings").       | `https://mi-bot-abcd.up.railway.app` |

---

### ⚠️ Archivo `.gitignore`

Este repositorio incluye un archivo `.gitignore` esencial que previene que los secretos (`.env`), las dependencias (`node_modules`) y los archivos de base de datos locales (`.db`) se suban a GitHub.
