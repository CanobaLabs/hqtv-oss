type HqSubmittedAnswer = {
    type: 'submittedAnswer';
    questionId: number;
    yourAnswerIds: number[];
    yourAnswerId: number | null;
}

export default HqSubmittedAnswer;
