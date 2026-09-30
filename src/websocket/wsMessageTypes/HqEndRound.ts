import LevelInfo from '../../common/types/level';

type HqEndRound = {
    type: 'endRound';
    answer: string[];
    hint: string;
    showId: number;
    roundId: number;
    roundNumber: number;
    roundDurationMs: number;
    winners: unknown[];
    correctAnswers: number;
    incorrectAnswers: number;
    totalRounds: number;
    extraLifeEligible: boolean;
    playerStatus: string;
    hasExtraLife: boolean;
    buyBackInAvailable: boolean;
    completionTime: number;
    solved: boolean;
    stars: number;
    eliminatedInfo: {
        currentPoints: number;
        previousPoints: number;
    };
    seasonXp?: {
        name: string;
        currentLevelNumber: number;
        currentPoints: number;
        previousPoints: number;
        letterPoints: number;
        timeBonus: number;
        solvedPoints: number;
        message: unknown;
        pointsEarnedOverlayDelayMs: number;
        pointsEarnedOverlayDurationMs: number;
        levels: LevelInfo[];
    };
    foundLetters: string[];
}

export default HqEndRound;
