import HqSubmittedAnswer from '../wsMessageTypes/HqSubmittedAnswer';

function constructSubmittedAnswer(questionId: number, answerId: number | null) {
    return {
        type: 'submittedAnswer',
        questionId: questionId,
        yourAnswerIds: [],
        yourAnswerId: answerId
    } as HqSubmittedAnswer;
}

export default constructSubmittedAnswer;
