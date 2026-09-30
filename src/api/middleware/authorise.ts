import { NextFunction, Request, Response } from 'express';
import { getUser } from '../../common/utils/userGetters';
import verifyBearer from '../../common/utils/verifyBearer';
import catchErrors from './catchErrors';

function authorise(authRequired: boolean = true) {
    return catchErrors(async (req: Request, res: Response, next: NextFunction) => {
        const authHeader = req.get('Authorization');
        if (!authRequired && !authHeader) return next(); // auth not provided and not required by the endpoint
        if (req.cfAuth) return next(); // User has been authenticated as an employee

        const authUser = await verifyBearer(authHeader);
        req.authUser = authUser;

        // get requested user
        if (req.params.userId == 'me' || req.params.userId == null) {
            // self
            req.reqUser = authUser;
        } else {
            // requesting another user
            req.reqUser = await getUser(+req.params.userId);
        }
        return next();
    });
}

export default authorise;
