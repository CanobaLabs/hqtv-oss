type HqWordsGameResult = {
    type: 'wordsGameResult';
    showId: number;
    winners: {
        winner: {
            username: string;
            avatarUrl: string;
            userId: number;
        };
        rank: number;
        prize: string;
        time: number;
    }[];
    numWinners: number;
    totalTime: number;
}

export default HqWordsGameResult;
