type OffairTriviaStartQuestion = {
    gameUuid: string;
    questionCount: number;
    question: {
        question: string;
        answers: { offairAnswerId: string; text: string; }[];
        questionNumber: number;
        totalTimeMs: number;
        timeLeftMs: number;
        erase1: boolean;
    };
    erase1s: number;
}

export default OffairTriviaStartQuestion;
