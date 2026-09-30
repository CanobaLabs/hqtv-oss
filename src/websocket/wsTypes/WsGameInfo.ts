type WsGameInfo = {
    gameId: number;
    broadcastId: number;
    rehearsal: boolean;
    forReal: boolean;
    showType: string;
    gameType: string;
    startActual: Date;
    prizeCents: number;
    prizePoints: number;
    questionId: number | null;
    questionNumber: number;
    questionCount: number;
    seasonEnabled: boolean;
    winnersCap: number | null;
    maxLives: number | null;
    maxErasers: number | null;
    strikeLimit: number;
    splitCents?: boolean;
    splitPoints?: boolean;
    wheelLetters: string;
    superWheelItems: { name: string; letters: string; lives: number; }[];
    wheelRevealed: boolean;
    chatDisabled: boolean;
}

export default WsGameInfo;
