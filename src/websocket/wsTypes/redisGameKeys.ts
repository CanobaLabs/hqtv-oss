const rGameKey = (broadcastId: number) => {
    const b = `broadcast:${broadcastId}`;
    return {
        question: (questionNumber: number) => {
            const q = `${b}:question:instance:${questionNumber}`;
            return {
                // relevant to all question types
                q: q,
                resultsReady: `${q}:resultsReady`,
                roundPlaying: `${q}:roundPlaying`,
                correctPlayers: `${q}:correctPlayers`,
                wrongPlayers: `${q}:wrongPlayers`,
                roundEliminated: `${q}:roundEliminated`,
                pointsEarned: `${q}:pointsEarned`,
                letterPoints: `${q}:letterPoints`,
                timeBonus: `${q}:timeBonus`,
                solvedPoints: `${q}:solvedPoints`,
                savedByWinnersCap: `${q}:savedByWinnersCap`,
                savedByStaff: `${q}:savedByStaff`,
                usedLife: `${q}:usedLife`,
                reachedWinnersCap: `${q}:reachedWinnersCap`,
                // trivia-specific
                roundKeepPlaying: `${q}:roundKeepPlaying`,
                playerAnswers: `${q}:playerAnswers`,
                keepPlayingAnswers: `${q}:keepPlayingAnswers`,
                correctOverall: `${q}:correctOverall`,
                correctKeepPlaying: `${q}:correctKeepPlaying`,
                savedByFreePass: `${q}:savedByFreePass`,
                usedEraser: `${q}:usedEraser`,
                // puzzles - words
                strikedOut: `${q}:strikedOut`,
                solveTime: `${q}:solveTime`
            }
        },
        checkpoint: (id: string) => {
            const cp = `${b}:checkpoint:${id}`;
            return {
                cp: cp,
                prizes: `${cp}:prizes`,
                points: `${cp}:points`,
                cachedWinners: `${cp}:cachedWinners`
            }
        },
        questionIds: `${b}:questionIds`,
        questionModel: (qId: number) => `${b}:question:model:${qId}`,
        currentSurveyNumber: `${b}:currentSurveyNumber`,
        allCheckpointIds: `${b}:allCheckpointIds`,
        nextCheckpointIds: `${b}:nextCheckpointIds`,
        currentCheckpointId: `${b}:currentCheckpointId`,
        allSurveyQuestionIds: `${b}:allSurveyQuestionIds`,
        nextSurveyQuestionIds: `${b}:nextSurveyQuestionIds`,
        currentSurveyQuestionId: `${b}:currentSurveyQuestionId`,
        surveyQuestion: (surveyQId: string) => `${b}:surveyQuestion:${surveyQId}`,
        surveyAnswerVotes: (surveyQId: string, answerId: string) => `${b}:surveyQuestion:${surveyQId}:vote:${answerId}`,
        giftDropIds: `${b}:giftDropIds`,
        giftDrop: (giftDropId: number) => `${b}:giftDrop:${giftDropId}`,
        usedLifeLock: (plrId: string) => `${b}:usedLifeLock:${plrId}`,
        usedEraserLock: (plrId: string) => `${b}:usedEraserLock:${plrId}`,
        viewers: (mode: string) => `${b}:viewers:${mode}`,
        guessedLetters: (puzzleId: number, plrId: string) => `${b}:puzzleState:${puzzleId}:${plrId}:guessedLetters`,
        foundLetters: (puzzleId: number, plrId: string) => `${b}:puzzleState:${puzzleId}:${plrId}:foundLetters`,
        gameActiveFlag: `${b}:gameActiveFlag`,
        gameInfo: `${b}:gameInfo`,
        currentState: `${b}:currentState`,
        inTheGame: `${b}:inTheGame`,
        eliminated: `${b}:eliminated`,
        joinedPlayers: `${b}:joinedPlayers`,
        joinTime: `${b}:joinTime`,
        xHqClient: `${b}:xHqClient`,
        lastViewersAudit: `${b}:lastViewersAudit`,
        lastViewersRefresh: `${b}:lastViewersRefresh`,
        chatRelayLock: `${b}:chatRelayLock`,
        runCommandLock: `${b}:runCommandLock`,
        viewerCounts: `${b}:viewerCounts`,
        roundStats: `${b}:roundStats`,
        connected: `${b}:connected`,
        playingViewers: `${b}:viewers:playing`,
        watchingViewers: `${b}:viewers:watching`,
        kicked: `${b}:kicked`,
        unrelayedChat: `${b}:unrelayedChat`,
        chatMessages: `${b}:chat`,
        noNewPlayersFlag: `${b}:noNewPlayers`,
        sessionPoints: `${b}:sessionPoints`,
        totalSeasonXp: `${b}:totalSeasonXp`,
        keepPlayingRewardCoins: `${b}:keepPlayingRewardCoins`,
        keepPlayingRewardLives: `${b}:keepPlayingRewardLives`,
        keepPlayingRewardErasers: `${b}:keepPlayingRewardErasers`,
        usedSuperSpin: `${b}:usedSuperSpin`,
        disabledAnswerSharing: `${b}:disabledAnswerSharing`,
        livesEarned: `${b}:livesEarned`,
        streaksAdvanced: `${b}:streaksAdvanced`,
        livesUsed: `${b}:livesUsed`,
        erasersUsed: `${b}:erasersUsed`,
        superSpinLivesWon: `${b}:superSpinLivesWon`,
        totalSolveTime: `${b}:totalSolveTime`,
        solvingPlayers: `${b}:solvingPlayers`,
        playerFreeLetters: `${b}:playerFreeLetters`,
        playerStrikes: `${b}:playerStrikes`,
        cashWonFromJackPot: `${b}:cashWonFromJackPot`,
        pointsWonFromJackPot: `${b}:pointsWonFromJackPot`,
        winners: `${b}:winners`,
        streaksAudited: `${b}:streaksAudited`
    }
}

export default rGameKey;
