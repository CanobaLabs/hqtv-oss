type User = {
    id: number;
    actualName: string;
    dispName: string;
    avatarUrl: string | null;
    created: Date;
    admin: boolean;
    tester: boolean;
    purged: boolean;
    booster: boolean;
    lives: number;
    erasers: number;
    superSpins: number;
    coins: number;
    seasonXp: number;
    chatBan: number;
    gameBan: number;
    appBan: number;
}

export default User;
