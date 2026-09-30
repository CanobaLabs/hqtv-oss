type HqBroadcastStats = {
    type: 'broadcastStats';
    statusMessage: string;
    userId?: number;
    viewerCounts: {
        connected: number;
        playing: number;
        watching: number;
    };
    roundId?: number;
    roundPlaying?: number;
    roundCompleted?: number;
    roundEliminated?: number;
}

export default HqBroadcastStats;
