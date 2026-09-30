type HqInteraction = {
    type: 'interaction';
    itemId: string;
    userId: number;
    metadata: {
        userId: number;
        username: string;
        avatarUrl: string;
    };
}

export default HqInteraction;
