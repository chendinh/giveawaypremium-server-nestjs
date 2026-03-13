import * as root from 'app-root-path';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const { createLogger, format, transports } = winston;
const { combine, timestamp, label, printf } = format;

const myFormat = printf((options) => {
  return `${options.timestamp} [${options.label}] ${options.level}: ${options.message}`;
});

const logger = createLogger({
  format: combine(label({ label: 'APPLICATION' }), timestamp(), myFormat),
  transports: [
    new DailyRotateFile({
      datePattern: 'YYYY-MM-DD',
      filename: '%DATE%.log',
      dirname: `${root}/logs/`,
      utc: true,
      level: 'info',
    }),
    new DailyRotateFile({
      datePattern: 'YYYY-MM-DD',
      filename: '%DATE%.err.log',
      dirname: `${root}/logs/`,
      utc: true,
      level: 'error',
    }),
  ],
});

logger.add(
  new transports.Console({
    handleExceptions: true,
    format: format.combine(
      format.colorize({
        all: true,
      }),
    ),
  }),
);

export default logger;
