import RedisCheckpointWinnerDeserialised from '../redisSchemas/redisCheckpointWinnerDeserialised';

type HqCheckpointSummary = {
    type: 'checkpointSummary';
    checkpointId: string;
    playingStatus: string;
    prizeOffered: string;
    numWinners: number;
    winners: RedisCheckpointWinnerDeserialised[];
    playersRemaining: number;
    youWon: boolean;
    questionNumber: number;
    questionCount: number;
    nextCheckpointIn: number;
    durationMs: number;
    userPointsMultiplier: number | null;
}

export default HqCheckpointSummary;
