import redis from "../../common/redisClient";
import rKey from "../../common/redisKeys";

async function getDiscordUser(userIdOrToken: string, includeStreamFields: boolean = false) {
    const cachedUser = await redis.exists(rKey.employee(userIdOrToken));
    if (cachedUser) {
        const fields = ['name', 'userId', 'avatarId', 'mfa_enabled', 'email', 'verified', 'needsRealName', 'position', 'hired', 'removed', 'removedWhy', 'category', 'pinned'];
        if (includeStreamFields) {
            fields.push('streamKey');
        }
        const [name, userId, avatarId, mfa_enabled, email, verified, needsRealName, position, hired, removed, removedWhy, category, pinned, streamKey] = await Promise.resolve(
            redis.hmGet(rKey.employee(userIdOrToken), fields)
        )
        const lastOnline = await redis.get(rKey.employeeLastOnline(userIdOrToken))
        const result: any = {
            id: userIdOrToken,
            userId: userId,
            name,
            email: email ?? null,
            verified: verified === 'true',
            avatarId,
            mfa_enabled: mfa_enabled === 'true',
            needsRealName: needsRealName === 'true' ? true : false,
            position: position ?? "Employee",
            hired: hired ?? null,
            removed: removed ?? null,
            removedWhy: removedWhy ?? null,
            category: category ?? "other",
            pinned: pinned === "true" ? true : false,
            lastOnline
        };
        if (includeStreamFields) {
            result.streamKey = streamKey ?? null;
        }
        return result;
    }
    return null;
}

export default getDiscordUser;