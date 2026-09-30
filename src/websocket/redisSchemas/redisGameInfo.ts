type RedisGameInfo = {
    gameId: string;
    broadcastId: string;
    rehearsal: string;
    forReal: string;
    liveConfigId?: string;
    showType: string;
    gameType: string;
    startActual: string;
    prizeCents: string;
    prizePoints: string;
    questionId?: string;
    questionNumber: string;
    questionCount: string;
    seasonEnabled: string;
    splitCents?: string;
    splitPoints?: string;
    winnersCap?: string;
    maxLives?: string;
    maxErasers?: string;
    strikeLimit: string;
    wheelLetters?: string;
    superWheelItems?: string;
    wheelRevealed?: string;
    wheelStartTime?: string;
    chatDisabled?: string;
}

export default RedisGameInfo;
