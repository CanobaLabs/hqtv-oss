import { Request } from 'express';
import jwt, { Secret } from 'jsonwebtoken';
import LoginToken from '../../common/database/userModels/loginToken';
import HqId from '../../common/hqId';
import User from '../../common/types/user';
import { getClientIp } from './getClientIp';

async function newAuth(user: User | null, suppliedLoginToken: string | null, headers: Request['headers'], referralDenied: boolean = false) {
    if (!user) {
        // no existing account
        return null;
    }

    let loginToken: string;
    if (suppliedLoginToken) {
        // reuse
        loginToken = suppliedLoginToken;
    } else {
        // generate new
        loginToken = new HqId().loginToken();
        await LoginToken.create({
            token: loginToken,
            userId: user.id,
            ipAddress: getClientIp({ headers, ip: undefined }),
            xHqDeviceId: headers['x-hq-device-id']
        });
    }

    const roles: string[] = [];
    if (user.admin) {
        roles.push('admin');
    }
    if (user.tester) {
        roles.push('tester');
    }
    const tokenPayload = {
        userId: user.id,
        username: user.dispName,
        avatarUrl: user.avatarUrl,
        token: null,
        roles,
        client: headers['x-hq-client'] ?? null,
        guestId: null,
        v: 1
    }
    const JWT_SIGNATURE = process.env.JWT_SIGNATURE as Secret;
    const JWT_OPTIONS = { expiresIn: '90 days', issuer: 'hqtvquiz/1' };
    const accessToken = jwt.sign({ ...tokenPayload, token: loginToken.substring(0, 6) }, JWT_SIGNATURE, JWT_OPTIONS);
    const authToken = jwt.sign({ ...tokenPayload, token: null }, JWT_SIGNATURE, JWT_OPTIONS);

    return {
        userId: user.id,
        username: user.dispName,
        admin: true,
        tester: !!user.tester,
        guest: !user,
        avatarUrl: user.avatarUrl,
        loginToken,
        accessToken,
        authToken,
        canEnterReferral: false,
        wasReferralDenied: referralDenied
    }
}

export default newAuth;
