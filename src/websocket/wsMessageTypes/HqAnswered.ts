type HqAnswered = {
    type: 'answered';
    userId: number;
    username: string;
    avatarUrl: string | null;
    answerIds: number[];
    questionId: number;
    answerId: number;
};

export default HqAnswered;
