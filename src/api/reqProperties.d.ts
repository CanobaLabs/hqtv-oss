type User = import('../common/types/user').default;

declare namespace Express {
    interface Request {
        cfAuth: { id: string; userId: string; name: string; avatarId: string; needsRealName: boolean; position: string; } | null;
        authUser: User;
        reqUser: User;
        offset: number;
        broadcastId: number;
    }
}
