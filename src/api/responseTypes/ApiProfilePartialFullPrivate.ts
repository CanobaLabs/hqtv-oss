import LevelInfo from '../../common/types/level';
import ApiProfileFullPublic from './ApiProfilePartialFullPublic';

type ApiProfileFullPrivate = ApiProfileFullPublic & {
    voip: boolean;
    deviceTokens: string[];
    hasPhone: boolean;
    phoneNumber: string | null;
    pin: 0 | 1;
    lives: number;
    referred: boolean;
    referringUserId: number | null;
    blocked: boolean;
    blocksMe: boolean;
    preferences: { [prefName: string]: boolean; };
    friendIds: number[];
    achievementCount: number;
    items: {
        lives: number;
        superSpins: number;
    };
    coins: number;
    stk: string;
    streakInfo: {
        userId: number;
        target: number;
        startDate: string;
        current: number;
        total: number;
        lastPlayed: string;
        notify: boolean;
        lifeUuid: null;
    };
    erase1s: number;
    pointsMultiplierCounts: { [x: string]: number; };
    seasonXp: {
        name: string;
        currentPoints: number;
        isActive: boolean;
        verticals: string[];
        currentLevel: {
            level: number;
            minPoints: number;
            maxPoints: number;
        };
        achievedLevel: LevelInfo;
        quotas: {
            currentReferrals: number;
            currentSharesToFacebook: number;
            currentSharesToTwitter: number;
        };
        pointsEarnedOverlayDelayMs: number;
        pointsEarnedOverlayDurationMs: number;
    }[];
}

export default ApiProfileFullPrivate;
