type HqQuestion = {
    type: 'question';
    totalTimeMs: number;
    timeLeftMs: number;
    questionId: number;
    question: string;
    category: string;
    answers: {
        answerId: number;
        text: string;
    }[];
    questionNumber: number;
    questionCount: number;
    nextCheckpointIn: number | null;
    askTime: string;
    erase1: boolean;
    extraLifeEligible: boolean;
    freePassAvailable: boolean;
    questionMedia: {
        key: string;
        type: string;
        mediaId: string;
        contentType: string;
    } | null;
    playingStatus: string;
    submittedAnswerId: number;
    keepPlaying: boolean;
}

export default HqQuestion;
