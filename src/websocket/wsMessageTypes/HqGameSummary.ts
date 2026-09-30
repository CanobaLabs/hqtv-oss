type HqGameSummary = {
    type: 'gameSummary';
    showId: number;
    numWinners: number;
    flags: number;
    winners: {
        name: string;
        id: number;
        avatarUrl: string;
        prize: string;
        wins: number;
        userPointsMultiplier: null;
    }[];
    youWon: boolean;
    yourPrize: string;
    keepPlayingSummary: {
        gotToQuestionNumber: number;
        questionsRight: number;
        totalQuestions: number;
        answerSummary: {
            questionId: number;
            gotItRight: boolean;
            usedExtraLife: boolean;
            keepPlaying: boolean;
        }[];
        tk: string;
        rewards: {
            coins?: number;
            extraLives?: number;
            erase1s?: number;
        }
    } | null;
}

export default HqGameSummary;
