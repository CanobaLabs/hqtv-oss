import OffairTriviaNextQuestion from './OffairTriviaNextQuestion';
import OffairTriviaGameSummary from './OffairTriviaGameSummary';

type OffairTriviaAnswerResults = {
    seasonXp: unknown | null;
    pointsEarned: number;
    coinsEarned: number;
    youGotItRight: boolean;
    answerCounts: { offairAnswerId: string; answer: string; correct: boolean; }[];
    yourOffairAnswerId: unknown | null;
    questionNumber: number;
    answerResults: boolean[];
    nextQuestion: OffairTriviaNextQuestion | null;
    showAd: boolean;
    gameSummary: OffairTriviaGameSummary | null;
}

export default OffairTriviaAnswerResults;
