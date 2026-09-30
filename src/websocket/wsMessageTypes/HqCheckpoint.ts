type HqCheckpoint = {
    type: 'checkpoint';
    checkpointId: string;
    inTheGame: boolean;
    playingStatus: string;
    prizeOffered: string;
    prizeTotal: string;
    playersRemaining: number;
    questionNumber: number;
    questionCount: number;
    nextCheckpointIn: number;
    isFinalCheckpoint: boolean;
    durationMs: number;
    userPointsMultiplier: number | null;
}

export default HqCheckpoint;
