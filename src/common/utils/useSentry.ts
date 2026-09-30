import * as Sentry from '@sentry/node';
import { Express } from 'express';

// Set up Express error handler for Sentry
// Note: Sentry must be initialized before Express is imported (via initSentry.ts)
function useSentry(api: Express) {
    if (process.env.NODE_ENV === 'production') {
        Sentry.setupExpressErrorHandler(api);
    }
}

export default useSentry;
