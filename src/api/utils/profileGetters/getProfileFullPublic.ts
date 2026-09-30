import User from '../../../common/types/user';
import ApiProfileFullPublic from '../../responseTypes/ApiProfilePartialFullPublic';
import getProfileFullPrivate from './getProfileFullPrivate';
import getProfilePartialWithCreated from './getProfilePartialWithCreated';

async function getProfileFullPublic(user?: User): Promise<ApiProfileFullPublic> {
    const profileInfo = await getProfileFullPrivate(user);
    return {
        ...getProfilePartialWithCreated(user),
        broadcasts: profileInfo.broadcasts,
        featured: profileInfo.featured,
        referralUrl: profileInfo.referralUrl,
        highScore: profileInfo.highScore,
        gamesPlayed: profileInfo.gamesPlayed,
        winCount: profileInfo.winCount,
        leaderboard: profileInfo.leaderboard
    }
}

export default getProfileFullPublic;
