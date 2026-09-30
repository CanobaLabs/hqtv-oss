type WsPuzzle = {
    id: number;
    totalTimeMs: number;
    hint: string;
    answer: string;
    lifeEligible: boolean;
    revealedLetters: string;
    askTime: number | null;
    advancingCount: number | null;
    eliminatedCount: number | null;
    resultsRevealed: boolean;
}

export default WsPuzzle;
