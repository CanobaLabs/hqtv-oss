type RedisQuestion = {
    id: string;
    totalTimeMs: string;
    question: string;
    answers: string;
    lifeEligible: string;
    eraserAnswerId?: string;
    media?: string;
    askTime?: string;
    answerCounts?: string;
    advancingCount?: string;
    eliminatedCount?: string;
}

export default RedisQuestion;
