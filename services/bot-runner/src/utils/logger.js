const { config } = require('./config');

class Logger {
  constructor(module) {
    this.module = module;
    this.enableLogging = config.dev.enableLogging;
  }
  
  log(level, message, data = null) {
    if (!this.enableLogging && level !== 'error') return;
    
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.module}]`;
    
    if (data) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }
  
  info(message, data) {
    this.log('info', message, data);
  }
  
  warn(message, data) {
    this.log('warn', message, data);
  }
  
  error(message, data) {
    this.log('error', message, data);
  }
  
  debug(message, data) {
    this.log('debug', message, data);
  }
}

function createLogger(module) {
  return new Logger(module);
}

module.exports = { createLogger };
