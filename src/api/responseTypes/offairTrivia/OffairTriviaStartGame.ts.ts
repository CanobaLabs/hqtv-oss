import OffairTriviaReminder from './OffairTriviaReminder';

type OffairTriviaStartGame = {
    gameUuid: string;
    status: string;
    questionNumber: number;
    questionCount: number;
    answerResults: boolean[];
    category: string;
    reminders: OffairTriviaReminder[];
}

export default OffairTriviaStartGame;
