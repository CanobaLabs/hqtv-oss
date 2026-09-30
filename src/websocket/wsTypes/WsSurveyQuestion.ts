type WsSurveyQuestion = {
    id: string;
    durationMs: number;
    question: string;
    answers: { surveyAnswerId: string; text: string; }[];
    resultsDisplayMs: number;
    startTime: number | null;
    endTime: number | null;
}

export default WsSurveyQuestion;
