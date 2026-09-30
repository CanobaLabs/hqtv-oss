type RedisPuzzle = {
    id: string;
    totalTimeMs: string;
    hint: string;
    answer: string;
    revealedLetters: string;
    lifeEligible: string;
    askTime?: string;
    advancingCount?: string;
    eliminatedCount?: string;
    resultsRevealed?: string;
}

export default RedisPuzzle;
