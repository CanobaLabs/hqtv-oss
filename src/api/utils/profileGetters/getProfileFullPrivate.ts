import GamePlayed from '../../../common/database/userModels/gamesPlayed';
import Keychain from '../../../common/database/userModels/keychain';
import Referral from '../../../common/database/userModels/referral';
import { LbMode } from '../../../common/enums';
import redis from '../../../common/redisClient';
import rKey from '../../../common/redisKeys';
import User from '../../../common/types/user';
import centsToDollars from '../../../common/utils/centsToDollars';
import getFriendIds from '../../../common/utils/getFriendIds';
import getStreakConfig from '../../../common/utils/getStreakConfig';
import levelFromPoints from '../../../common/utils/levelFromPoints';
import { levelsWithMaxPoints } from '../../../websocket/helpers/bulkPlayerMethods';
import ApiProfileFullPrivate from '../../responseTypes/ApiProfilePartialFullPrivate';
import getBalanceSummary from '../getBalanceSummary';
import getLeaderboard from '../getLeaderboard';
import getSeason from '../getSeason';
import getProfilePartialWithCreated from './getProfilePartialWithCreated';
import getPointsToNextLevel from '../../../common/utils/getPointsToNextLevel';
import { all } from 'better-all';

async function getProfileFullPrivate(user?: User): Promise<ApiProfileFullPrivate> {
    const userId = user?.id ?? 0;
    const { season, streakConfig, streakInProgress, accountKey, referral, gamesPlayed, balanceSummary, friendIds, alltimeLb, weekLb } = await all({
        async season() { return getSeason(); },
        async streakConfig() { return getStreakConfig(); },
        async streakInProgress() { return redis.hGetAll(rKey.streakInProgress(userId)); },
        async accountKey() { return Keychain.findOne({ where: { userId: userId } }); },
        async referral() { return Referral.findOne({ where: { newUserId: userId } }); },
        async gamesPlayed() { return GamePlayed.findAll({ where: { userId: userId } }); },
        async balanceSummary() { return getBalanceSummary(userId); },
        async friendIds() { return getFriendIds(userId); },
        async alltimeLb() { return getLeaderboard(LbMode.Alltime); },
        async weekLb() { return getLeaderboard(LbMode.Week); }
    });
    const alltimeRank = (alltimeLb.findIndex(w => w.userId === userId) + 1) || 101;
    const weekRank = (weekLb.findIndex(w => w.userId === userId) + 1) || 101;

    const seasonXp = [];
    if (season) {
        const levels = levelsWithMaxPoints(season.levels, user?.seasonXp ?? 0)
        const currentLevelInfo = levelFromPoints(user?.seasonXp ?? 0, levels);
        seasonXp.push({
            name: season.seasonName,
            currentPoints: user?.seasonXp ?? 0,
            remainingPoints: getPointsToNextLevel(season.levels, user?.seasonXp ?? 0, currentLevelInfo.level),
            isActive: true,
            verticals: ['trivia', 'words'],
            currentLevel: {
                level: currentLevelInfo.level,
                minPoints: currentLevelInfo.minPoints,
                maxPoints: currentLevelInfo.maxPoints
            },
            achievedLevel: season.levels.find(l => l.level === currentLevelInfo.level)!,
            quotas: {
                currentReferrals: 0,
                currentSharesToFacebook: 0,
                currentSharesToTwitter: 0
            },
            pointsEarnedOverlayDelayMs: 3000,
            pointsEarnedOverlayDurationMs: 6000
        })
    }

    return {
        ...getProfilePartialWithCreated(user),
        broadcasts: { data: [] },
        featured: false,
        voip: false,
        deviceTokens: [],
        hasPhone: !!accountKey?.phone,
        phoneNumber: accountKey?.phone ?? null,
        pin: (accountKey?.pinHash && accountKey.pinHash.trim() !== '') ? 1 : 0,
        referralUrl: null,
        lives: user?.lives ?? 0,
        referred: !!referral,
        referringUserId: referral?.referralUserId ?? null,
        highScore: Math.max(...gamesPlayed.map(gp => gp.score)),
        gamesPlayed: gamesPlayed.length,
        winCount: balanceSummary.wins.length,
        blocked: false,
        blocksMe: false,
        preferences: {},
        friendIds: friendIds,
        achievementCount: 0,
        leaderboard: {
            wins: balanceSummary.wins.length,
            rank: alltimeRank,
            alltime: {
                total: centsToDollars(balanceSummary.prizeTotalCents),
                wins: balanceSummary.wins.length,
                rank: alltimeRank
            },
            weekly: {
                total: centsToDollars(balanceSummary.weekTotalCents),
                wins: balanceSummary.winsThisWeek,
                rank: weekRank
            },
            totalCents: balanceSummary.availableCents,
            total: centsToDollars(balanceSummary.availableCents),
            unclaimed: centsToDollars(balanceSummary.availableCents)
        },
        items: {
            lives: user?.lives ?? 0,
            superSpins: user?.superSpins ?? 0
        },
        coins: user?.coins ?? 0,
        stk: 'MQ==',
        streakInfo: {
            userId: userId,
            target: +(streakInProgress.target ?? streakConfig.streakTarget),
            startDate: streakInProgress.startDate ?? new Date().toISOString(),
            current: +(streakInProgress.current ?? '0'),
            total: +(streakInProgress.current ?? '0'),
            lastPlayed: streakInProgress.lastPlayed ?? new Date().toISOString(),
            notify: false,
            lifeUuid: null
        },
        erase1s: user?.erasers ?? 0,
        pointsMultiplierCounts: {
            ['2']: 0, ['3']: 0, ['4']: 0, ['5']: 0, ['10']: 0, ['15']: 0
        },
        seasonXp: seasonXp
    }
}

export default getProfileFullPrivate;
