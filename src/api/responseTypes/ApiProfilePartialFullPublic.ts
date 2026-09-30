import ApiProfilePartialWithCreated from './ApiProfilePartialWithCreated';

type ApiProfileFullPublic = ApiProfilePartialWithCreated & {
    broadcasts: { data: never[] };
    featured: boolean;
    referralUrl: string | null;
    highScore: number;
    gamesPlayed: number;
    winCount: number;
    leaderboard: {
        wins: number;
        rank: number;
        alltime: {
            total: string;
            wins: number;
            rank: number;
        },
        weekly: {
            total: string;
            wins: number;
            rank: number;
        },
        totalCents: number;
        total: string;
        unclaimed: string;
    }
}

export default ApiProfileFullPublic;
