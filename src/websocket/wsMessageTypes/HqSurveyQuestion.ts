type HqSurveyQuestion = {
    type: 'surveyQuestion';
    surveyQuestionId: string;
    question: string;
    answers: { surveyAnswerId: string; displayText: string; }[];
    durationMs: number;
    dismissDurationMs: number;
}

export default HqSurveyQuestion;
