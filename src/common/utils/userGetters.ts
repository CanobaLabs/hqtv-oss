import { Op, Transaction } from 'sequelize';
import Account from '../database/userModels/account';
import ItemHistory from '../database/userModels/itemHistory';
import { ChatBanLevel, GameBanLevel } from '../enums';
import HqError from '../hqError';
import logger from '../logger';
import redis from '../redisClient';
import RedisUserAsStored from '../types/redisUserAsStored';
import User from '../types/user';
import rKey from '../redisKeys';

function constructRedisUserPayload(acc: Account | null, bals?: { lives: number; erasers: number; superSpins: number; coins: number; seasonXp: number; }): RedisUserAsStored {
    // the payload as stored in redis
    const e = {
        name: acc?.name ?? '?',
        avatarUrl: acc?.avatarUrl ?? '',
        created: (acc?.created ?? new Date()).toISOString(),
        admin: (acc?.admin ?? 0).toString(),
        tester: (acc?.tester ?? 0).toString(),
        purged: (acc?.purged ?? 0).toString(),
        booster: (acc?.booster ?? 0).toString(),
        lives: (bals?.lives ?? 0).toString(),
        erasers: (bals?.erasers ?? 0).toString(),
        superSpins: (bals?.superSpins ?? 0).toString(),
        coins: (bals?.coins ?? 0).toString(),
        seasonXp: (bals?.seasonXp ?? 0).toString(),
        chatBan: (acc?.chatBan ?? ChatBanLevel.NotBanned).toString(),
        gameBan: (acc?.gameBan ?? GameBanLevel.NotBanned).toString(),
        appBan: (acc?.appBan ?? 0).toString(),
        generated: new Date().toISOString()
    }
    return e;
}

function parseUser(userId: number, rUser: RedisUserAsStored): User {
    const e = {
        id: userId,
        dispName: rUser.booster == '1' ? ('⭐' + rUser.name) : rUser.name,
        actualName: rUser.name,
        avatarUrl: rUser.avatarUrl,
        created: new Date(rUser.created),
        admin: !!+rUser.admin,
        tester: !!+rUser.tester,
        purged: !!+rUser.purged,
        booster: !!+rUser.booster,
        lives: +rUser.lives,
        erasers: +rUser.erasers,
        superSpins: +rUser.superSpins,
        coins: +rUser.coins,
        seasonXp: +rUser.seasonXp,
        chatBan: +rUser.chatBan,
        gameBan: +rUser.gameBan,
        appBan: +rUser.appBan
    }
    return e;
}

function countUserItems(itemHistory: ItemHistory[]) {
    let lives = 0;
    let erasers = 0;
    let superSpins = 0;
    let coins = 0;
    let seasonXp = 0;
    itemHistory.forEach(e => {
        switch (e.item) {
            case 'lives':
                lives += e.qty;
                break;
            case 'erasers':
                erasers += e.qty;
                break;
            case 'superSpins':
                superSpins += e.qty;
                break;
            case 'coins':
                coins += e.qty;
                break;
            case 'seasonXp':
                seasonXp += e.qty;
                break;
        }
    });
    return { lives, erasers, superSpins, coins, seasonXp };
}

export async function getUser(userId: number, forceRefresh = false, transaction?: Transaction): Promise<User> {
    // gets user in redis cache
    if (!forceRefresh) {
        const cachedUser = await redis.hGetAll(rKey.user(userId)) as RedisUserAsStored | {};
        const isCached = Object.values(cachedUser).length > 0;
        if (isCached) {
            return parseUser(userId, cachedUser as RedisUserAsStored);
        }
    }
    // force refresh or user not cached
    const [account, itemHistory] = await Promise.all([
        Account.findOne({ where: { id: userId }, transaction }),
        ItemHistory.findAll({ where: { userId, counted: true }, transaction })
    ]);
    if (account) {
        const itemBalances = countUserItems(itemHistory);
        const rUser = constructRedisUserPayload(account, itemBalances);
        await redis.hSet(rKey.user(userId), rUser);
        return parseUser(userId, rUser);
    } else {
        throw new HqError(`User profile not found! userId=${userId}`, 409, 404);
    }
}

export async function bulkCacheUsers(userIds: number[]): Promise<RedisUserAsStored[]> {
    const [accounts, itemHistories] = await Promise.all([
        Account.findAll({ where: { id: { [Op.in]: userIds } } }),
        ItemHistory.findAll({ where: { userId: { [Op.in]: userIds }, counted: true } })
    ]);
    // findAll() ignores userIds not found so this logic ensures that accounts return in the same order
    const accountMap = new Map(accounts.map(acc => [acc.id, acc]));
    const orderedAccounts = userIds.map(id => accountMap.get(id) ?? null);

    // item histories return an unsorted array so map it by user id
    const groupedItemHistories: { [userId: number]: ItemHistory[] | undefined; } = {};
    itemHistories.forEach(e => {
        (groupedItemHistories[e.userId] ??= []).push(e);
    });

    const multi = redis.multi();
    const userPayloads = orderedAccounts.map((acc, index) => {
        if (acc) {
            const items = countUserItems(groupedItemHistories[acc.id] || []);
            const payload = constructRedisUserPayload(acc, items);
            multi.hSet(rKey.user(acc.id), payload);
            return payload;
        } else {
            logger.warn('Missing account', { userId: userIds[index] })
            return constructRedisUserPayload(null);
        }
    });
    await multi.exec();
    return userPayloads;
}

export async function bulkGetUsers(userIds: number[]): Promise<User[]> {
    const cachedUsers = await Promise.all(
        userIds.map(id => redis.hGetAll(rKey.user(id)))
    ) as RedisUserAsStored[];
    // cache some or all requested users, if needed
    const uncachedUserIds = userIds.filter((_, index) => 
        Object.keys(cachedUsers[index]).length == 0
    );
    if (uncachedUserIds.length > 0) {
        // Replace uncached entries with newly fetched users
        const newlyCachedUsers = await bulkCacheUsers(uncachedUserIds);
        const userIdToIndexMap = new Map(userIds.map((id, index) => [id, index]));
        uncachedUserIds.forEach((id, i) => {
            const index = userIdToIndexMap.get(id);
            if (index !== undefined) {
                cachedUsers[index] = newlyCachedUsers[i];
            }
        });
    }
    const users = cachedUsers.map((user, index) => {
        return parseUser(userIds[index], user as RedisUserAsStored);
    });
    return users;
}
