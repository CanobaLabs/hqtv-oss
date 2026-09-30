import OffairTriviaReminder from './OffairTriviaReminder';

type OffairTriviaGameSummary = {
    pointsEarned: number;
    coinsEarned: number;
    coinsTotal: number;
    pointsInfo: {
        currentLevelNumber: number;
        currentPoints: number;
        name: string;
        remainingPoints: number;
    } | null;
    powerups: { [key: string]: number; };
    questionsCorrect: number;
    questionsIncorrect: number;
    reminders: OffairTriviaReminder[];
    showAdToUnlock: boolean;
    waitTimeMs: number;
}

export default OffairTriviaGameSummary;
