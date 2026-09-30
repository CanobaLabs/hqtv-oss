// wrapper for request handlers
import { NextFunction, Request, RequestHandler, Response } from 'express';

function catchErrors(handler: RequestHandler) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    }
}

export default catchErrors;
