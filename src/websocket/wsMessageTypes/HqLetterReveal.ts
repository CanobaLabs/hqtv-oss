type HqLetterReveal = {
    type: 'letterReveal';
    showId: number;
    roundId: number;
    puzzleState: string[];
    reveal: string;
    correctGuess: boolean;
    duplicateGuess: boolean;
    strikes: number;
    eliminated: boolean;
    completionTime: number;
}

export default HqLetterReveal;
