type HqGuessResponse = {
    type: 'guessResponse';
    showId: number;
    roundId: number;
    puzzleState: string[];
    guess: string;
    correctGuess: boolean;
    duplicateGuess: boolean;
    strikes: number;
    eliminated: boolean;
    completionTime: number;
}

export default HqGuessResponse;
