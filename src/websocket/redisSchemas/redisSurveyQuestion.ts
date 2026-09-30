type RedisSurveyQuestion = {
    surveyQuestionId: string;
    durationMs: string;
    question: string;
    answers: string;
    resultsDisplayMs: string;
    startTime?: string;
    endTime?: string;
    resultsSent?: string;
}

export default RedisSurveyQuestion;
