import jwt, { JwtPayload, Secret } from 'jsonwebtoken';
import HqError from '../hqError';
import { getUser } from './userGetters';

const JWT_SIGNATURE = process.env.JWT_SIGNATURE as Secret;

async function verifyBearer(authHeader: string | undefined): Promise<User> {
    const bearer = authHeader?.split('Bearer ')[1];
    if (bearer) {
        let auth: JwtPayload | undefined;
        jwt.verify(bearer, JWT_SIGNATURE, (err, a) => {
            if (!err) auth = a as JwtPayload; // valid
        });
        if (auth) {
            const user = await getUser(auth.userId).catch(() => null);
            if (user && !user.appBan) return user;
        }
    }
    throw new HqError('Auth not valid.', 105, 401);
}

export default verifyBearer;
