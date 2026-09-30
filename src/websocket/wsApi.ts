// Initialize Sentry BEFORE importing Express
import '../common/utils/initSentry';

import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import HqError from '../common/hqError';
import logger from '../common/logger';
import useSentry from '../common/utils/useSentry';
import routes from './websocketApi/routes';
import redis from '../common/redisClient';
import rKey from '../common/redisKeys';

function startWsApi() {
    const api = express()
        .use(express.json())
        .use(cors())
        .set('json spaces', 2)
        .disable('x-powered-by')
        .disable('etag');

    useSentry(api);
    
    routes(api);

    api.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
        // error handler; must be defined after routes
        if (err instanceof HqError) {
            // an error we generated
            res.status(err.statusCode()).json(err);
        } else {
            // unexpected error
            logger.error(err);
            next(err);
        }
    });

    const server = http.createServer(api);

    server.on('listening', () => {
        logger.info('ws server ready');
        if (process.env?.ENVIRONMENT == "prod") redis.set(rKey.bootStatus('socket'), "booted");
    });

    server.listen(process.env.WSPORT || process.env.PORT || 8081);
    return { api, server };
}

export default startWsApi;
