// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Structured Logger
// ═══════════════════════════════════════════════════════════════════════════

import pino from 'pino';

const IS_DEV = process.env.NODE_ENV !== 'production';

const baseLogger = pino({
  level: process.env.LOG_LEVEL || (IS_DEV ? 'debug' : 'info'),
  transport: IS_DEV ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } : undefined,
  base: { service: 'etru', version: '1.0.0' },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  redact: {
    paths: ['ssn', 'ssn_encrypted', 'bank_routing', 'bank_account', '*.ssn', '*.ssn_encrypted'],
    censor: '[REDACTED]',
  },
});

export function createLogger(module: string): pino.Logger {
  return baseLogger.child({ module });
}

export { baseLogger as logger };
