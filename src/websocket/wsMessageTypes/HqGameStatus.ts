type HqGameStatus = {
    type: 'gameStatus';
    inTheGame: boolean;
    showId: number;
    prize: string;
    prizeCents: number;
    currency: string;
    prizePoints: number;
    startActual: string;
    extraLives: number;
    extraLivesRemaining: number;
    cardPlaysRemaining: number;
    questionId?: number;
    questionNumber: number;
    questionCount: number;
    currentState: Record<string, unknown> | null;
    erase1s: number;
    erase1sRemaining: number;
    erase1sEarned: number;
    buyBackInAvailable: boolean;
    coins: number;
    playingStatus: string;
}

export default HqGameStatus;
