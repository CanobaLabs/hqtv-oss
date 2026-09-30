import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import logger from '../logger';

// Initialize Sentry before Express is imported
// This must be imported before any Express imports
if (process.env.NODE_ENV === 'production') {
    process.on('uncaughtException', (err) => {
        logger.error('Caught exception: ', err);
        Sentry.captureException(err);
    });

    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        integrations: [
            Sentry.httpIntegration(),
            Sentry.captureConsoleIntegration({ levels: ['error'] }),
            nodeProfilingIntegration()
        ],
        tracesSampleRate: 1, // Capture 100% of the transactions
        profilesSampleRate: 1,
        environment: process.env.NODE_ENV
    });
}



