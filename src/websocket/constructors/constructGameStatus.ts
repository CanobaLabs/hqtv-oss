import centsToDollars from '../../common/utils/centsToDollars';
import { getUser } from '../../common/utils/userGetters';
import HqWebSocket from '../wsTypes/HqWebSocket';
import { checkIfPlayerInGame, getErase1sRemaining, getLivesRemaining, getPlayingStatus } from '../helpers/playerMethods';
import HqGameStatus from '../wsMessageTypes/HqGameStatus';
import WsGameInfo from '../wsTypes/WsGameInfo';
import { getWordsRoundNumber } from '../helpers/gameDataGetters';

async function constructGameStatus(gameInfo: WsGameInfo, ws: HqWebSocket, currentState: Record<string, unknown> | null = null) {
    const { gameType, questionNumber } = gameInfo;
    const isProducer = !!ws.producer;
    
    // For producers, try to get user but use defaults if it doesn't exist
    const userPromise = isProducer 
        ? getUser(ws.userId).catch(() => ({ lives: 0, erasers: 0, coins: 0 } as any))
        : getUser(ws.userId);
    
    // For producers, wrap player-specific functions that call getUser to handle errors
    const livesRemainingPromise = isProducer
        ? Promise.resolve(0).catch(() => 0)
        : getLivesRemaining(ws.player, gameInfo);
    
    const erase1sRemainingPromise = isProducer
        ? Promise.resolve(0).catch(() => 0)
        : getErase1sRemaining(ws.player, gameInfo);
    
    const [user, inTheGame, livesRemaining, erase1sRemaining, playingStatus] = await Promise.all([
        userPromise,
        isProducer ? Promise.resolve(false) : checkIfPlayerInGame(ws.player),
        livesRemainingPromise,
        erase1sRemainingPromise,
        isProducer ? Promise.resolve('watching' as const) : getPlayingStatus(ws.player)
    ]);
    const displayQuestionNum = gameType == 'words' ? getWordsRoundNumber(questionNumber) : questionNumber;
    
    return {
        type: 'gameStatus',
        inTheGame,
        showId: gameInfo.gameId,
        prize: centsToDollars(gameInfo.prizeCents),
        prizeCents: gameInfo.prizeCents,
        currency: 'USD',
        prizePoints: gameInfo.prizePoints,
        startActual: gameInfo.startActual.toISOString(),
        extraLives: user?.lives ?? 0,
        extraLivesRemaining: livesRemaining,
        cardPlaysRemaining: 0,
        questionId: gameInfo.questionId,
        questionNumber: displayQuestionNum, // glitched question number
        questionCount: gameInfo.questionCount,
        currentState: currentState,
        erase1s: user?.erasers ?? 0,
        erase1sRemaining: erase1sRemaining,
        erase1sEarned: 0,
        buyBackInAvailable: false,
        coins: user?.coins ?? 0,
        playingStatus: questionNumber === 0 ? 'pregame' : playingStatus
    } as HqGameStatus;
}

export default constructGameStatus;
