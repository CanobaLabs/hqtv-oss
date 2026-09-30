import bcrypt from 'bcryptjs';
import { Request } from 'express';
import ms from 'ms';
import { v4 as uuidv4 } from 'uuid';
import Keychain from '../../common/database/userModels/keychain';
import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import { getUser } from '../../common/utils/userGetters';
import newAuth from '../utils/newAuth';
import getGeneralConfig from '../utils/getGeneralConfig';
import * as users from './users';

export async function getOrCreatePhoneVerification(inputPhone: unknown, retryCount = 0) {
	const phone = inputPhone?.toString().replace(/[^+0-9]/g, ''); // only numbers & plus symbol
    if (!phone) {
        throw new HqError('phone is required', 401, 400);
    }
    
    const config = await getGeneralConfig();
    
    let [verificationId, expiryMs] = await Promise.all([
        redis.get(rKey.verificationIdFromPhone(phone)),
        redis.pExpireTime(rKey.verificationIdFromPhone(phone))
    ]);
    if (!verificationId) {
        // create new verification
        const lockAcquired = await redis.set(rKey.verificationLock(phone), 1, { NX: true, EX: config.verificationLockExpirySec });
        if (!lockAcquired) {
            // several requests sent at once
            if (retryCount < config.verificationMaxRetries) {
                // try again
                return await getOrCreatePhoneVerification(inputPhone, retryCount + 1);
            } else {
                throw new HqError('Failed to acquire lock', 0, 500);
            }
        }
        verificationId = uuidv4(), expiryMs = Date.now() + ms(`${config.verificationExpiryMinutes} minutes`);
        await redis.multi()
            .hSetNX(rKey.verification(verificationId), 'phone', phone)
            .pExpireAt(rKey.verification(verificationId), expiryMs) // verification expiry
            .set(rKey.verificationIdFromPhone(phone), verificationId, { NX: true, PXAT: expiryMs })
            .exec();
    }
    
    return {
        verificationId,
        phone: phone,
        retrySeconds: config.verificationRetryWaitSec,
        expires: new Date(expiryMs).toISOString(),
        callsEnabled: false
    }
}

export async function checkVerificationCode(verificationId: string, inputCode: unknown, headers: Request['headers'] = {}) {
    const phone = await redis.hGet(rKey.verification(verificationId), 'phone');
    if (!phone) {
        throw new HqError('Verification not found.', 454, 404);
    }
    
    const codeStr = (inputCode ?? '').toString();
    if (!codeStr) {
        throw new HqError('code is required', 401, 400);
    }
    
    const key = await Keychain.findOne({ where: { phone } });
    const codeMatches = (
        key && key.pinHash ? await bcrypt.compare(codeStr, key.pinHash) // has pin; check
        : true // no account or no pin; skip
    );
    if (codeMatches) {
        const [user] = await Promise.all([
            key ? getUser(key.userId) : null,
            redis.hSet(rKey.verification(verificationId), 'authed', 1), // unlock ability to create account via /users endpoint
        ])
        const auth = await newAuth(user, null, headers);
        return { auth };
    } else {
        throw new HqError('That verification code is incorrect.', 458, 400);
    }
}

export async function createAccountOrSignIn(inputVerificationId: unknown, inputUsername: unknown, headers: Request['headers'] = {}, retryCount = 0) {
	const verificationId = inputVerificationId?.toString();
    if (!verificationId) {
        throw new HqError('verificationId is required', 401, 400);
    }

	const [phone, authed] = await redis.hmGet(rKey.verification(verificationId), ['phone', 'authed']);
	if (!phone || !authed) {
		throw new HqError('Verification not found.', 454, 404);
	}

    const config = await getGeneralConfig();
    
    let userId: number;
    const key = await Keychain.findOne({ attributes: ['userId'], where: { phone } });
    if (key) {
        // existing account
        userId = key.userId;
    } else {
        // make new account
        const lockAcquired = await redis.set(rKey.createAccountLock(phone), '', { NX: true, EX: config.createAccountLockExpirySec }); // lock expires on its own
        if (!lockAcquired) {
            if (retryCount < config.verificationMaxRetries) {
                return await createAccountOrSignIn(inputVerificationId, inputUsername, headers, retryCount + 1);
            } else {
                throw new HqError('Failed to acquire lock', 0, 500);
            }
        }
        const newAccount = await users.createAccount(phone, inputUsername);
        userId = newAccount.id;
    }
    
    const user = await getUser(userId);
    const auth = await newAuth(user, null, headers);
    return auth;
}
