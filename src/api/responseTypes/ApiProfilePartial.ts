type ApiProfilePartial = {
    userId: number;
    username: string;
    admin: boolean;
    tester: boolean;
    booster: boolean;
    avatarUrl: string | null;
}

export default ApiProfilePartial;
