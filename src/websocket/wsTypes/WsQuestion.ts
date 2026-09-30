type WsQuestion = {
    id: number;
    totalTimeMs: number;
    question: string;
    answers: { id: number; text: string; correct: boolean; }[];
    media: { key: string; type: string; mediaId: string; contentType: string; } | null;
    lifeEligible: boolean;
    eraserAnswerId: number | null;
    askTime: number | null;
    answerCounts: { [answerId: number]: number; } | null;
    advancingCount: number | null;
    eliminatedCount: number | null;
}

export default WsQuestion;
