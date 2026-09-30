type HqStartRound = {
    type: 'startRound';
    showId: number;
    roundId: number;
    roundNumber: number;
    hint: string;
    puzzleState: string[];
    timeLeftMs: number;
    totalTimeMs: number;
    totalRounds: number;
    initialRevealedLetters: string[];
    freeLetters: string[];
    eliminated: boolean;
    strikes: number;
    strikeLimit: number;
    rolloverEnabled: boolean;
    freePassStrikes: number;
}

export default HqStartRound;
