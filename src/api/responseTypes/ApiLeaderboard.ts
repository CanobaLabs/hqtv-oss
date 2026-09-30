type ApiLeaderboard = {
    userId: number;
    username: string;
    avatarUrl: string | null;
    total: string;
    totalCents: number;
    wins: number;
}[];

export default ApiLeaderboard;
