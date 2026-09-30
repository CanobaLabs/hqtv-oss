import catchErrors from './catchErrors';
import HqError from "../../common/hqError";
import { calculateEmployeePermissionSets } from '../routeHandlers/employees';

function permission(permission: string) {
    return catchErrors(async (req, res, next) => {
        if (!req.cfAuth) throw new HqError('Unauthorized', 101, 401);
        const permissions = await calculateEmployeePermissionSets(req.cfAuth.userId);
        if (!permissions.combined.includes(permission)) throw new HqError('Forbidden. Requires permission: ' + permission, 102, 403);
        return next();
    });
}

export default permission;