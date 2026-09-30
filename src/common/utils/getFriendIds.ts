import { Op } from 'sequelize';
import FriendRequest from '../database/userModels/friendRequest';
import redis from '../redisClient';
import rKey from '../redisKeys';

async function getFriendIds(userId: number, refresh = false): Promise<number[]> {
    if (!refresh) {
        const cached = await redis.get(rKey.friendIds(userId));
        if (cached) {
            return JSON.parse(cached);
        }
    }
    // fetch from primary db
    const friends = await FriendRequest.findAll({ where: {
        accepted: true,
        [Op.or]: [{ senderId: userId }, { targetId: userId }]
    }});
    const friendIds: number[] = friends.map(fr => {
        // if they are userId1 then userId2 is the other user (and vice versa)
        if (fr.senderId == userId) {
            return fr.targetId;
        } else {
            return fr.senderId;
        }
    });
    const multi = redis.multi().del(rKey.friendIds(userId));
    if (friendIds.length > 0) {
        multi.set(rKey.friendIds(userId), JSON.stringify(friendIds));
    }
    await multi.exec();
    return friendIds;
}

export default getFriendIds;
