type HqSurveyResults = {
    type: 'surveyResults';
    surveyQuestionId: string;
    question: string;
    results: { surveyAnswerId: string; displayText: string; displayCount: string; voteCount: number; }[];
    voteCount: number;
    durationMs: number;
}

export default HqSurveyResults;
