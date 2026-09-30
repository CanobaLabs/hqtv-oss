import LevelInfo from '../../common/types/level';

type HqQuestionSummary = {
    type: 'questionSummary';
    questionId: number;
    questionNumber: number;
    question: string;
    answerCounts: {
        answerId: number;
        answer: string;
        correct: boolean;
        count: number;
    }[];
    advancingPlayersCount: number;
    eliminatedPlayersCount: number;
    nextCheckpointIn: number | null;
    questionMedia: {
        key: string;
        type: string;
        mediaId: string;
        contentType: string;
    } | null;
    playingStatus: string;
    youGotItRight: boolean;
    yourAnswerId: number;
    savedByExtraLife: boolean;
    extraLivesRemaining: number;
    pointsEarned: number;
    wasJustInTheGame: boolean;
    friendsAnswers: { [answerId: number]: {
        answerId: number;
        users: { userId: number; username: string; avatarUrl: string | null; }[];
    }; };
    buyBackInAvailable: boolean;
    availableProductIds: string[];
    achievements: unknown[];
    freePass?: { message: string; };
    levels?: {
        name: string;
        currentLevelNumber: number;
        currentPoints: number;
        previousPoints: number;
        remainingPoints: number;
        minimumRotationDegrees: number;
        levels: LevelInfo[];
    };
}

export default HqQuestionSummary;
