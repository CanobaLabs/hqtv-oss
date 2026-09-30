import { Request, Response, NextFunction } from 'express';

const getOffset = (req: Request, res: Response, next: NextFunction) => {
    req.offset = 0; // default
    if (req.query.after) {
        const after = (+req.query.after) || 0;
        if (after > 0) {
            req.offset = after;
        }
    } else if (req.query.before) {
        const before = (+req.query.before) || 0;
        const startPoint = before - 21; // set back by 20 results
        if (startPoint > 0) {
            req.offset = startPoint;
        }
    }
    return next();
};

export default getOffset;
