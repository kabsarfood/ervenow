const pino = require("pino");

const level = String(process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug")).trim();

/** Structured logging (Pino). */
const logger = pino({ level });

module.exports = { logger };
