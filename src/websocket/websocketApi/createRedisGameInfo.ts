import getSeason from '../../api/utils/getSeason';
import Game from '../../common/database/eventModels/game';
import TriviaGameMeta from '../../common/database/eventModels/triviaGameMeta';
import WordsGameMeta from '../../common/database/eventModels/wordsGameMeta';
import SuperWheelItem from '../../common/database/featureModels/superWheelItem';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import RedisGameInfo from '../redisSchemas/redisGameInfo';
import Show from '../../common/database/configModels/show';
import { outline } from '../../common/mongoClient';

async function createRedisGameInfo(
    game: Game, 
    show: Show, 
    broadcastId: number, 
    rehearsal: number, 
    forReal: number, 
    questionCount: number, 
    liveConfigId?: number,
    providedData?: {
        triviaMeta?: { winnersCap?: number; maxLives?: number; maxErasers?: number } | null;
        wordsMeta?: { strikes?: number; winnersCap?: number; maxLives?: number; superWheelEnabled?: boolean } | null;
        wordsOutline?: { outline: any[] } | null;
        season?: { seasonName: string; levels: any[] } | null;
        superWheelItems?: SuperWheelItem[];
    }
) {
    let strikeLimit: number = 10;
    let winnersCap: number | undefined;
    let maxLives: number | undefined;
    let maxErasers: number | undefined;
    let wheelLetters: string | undefined;
    let superWheelItems: SuperWheelItem[] | undefined;
    
    if (show.gameType === 'trivia') {
        const triviaMeta = providedData?.triviaMeta ?? (await TriviaGameMeta.findOne({ where: { gameId: game.gameId } }));
        triviaMeta?.winnersCap != null && (winnersCap = triviaMeta.winnersCap);
        triviaMeta?.maxLives != null && (maxLives = triviaMeta.maxLives);
        triviaMeta?.maxErasers != null && (maxErasers = triviaMeta.maxErasers);
    } else if (show.gameType === 'words') {
        const wordsMeta = providedData?.wordsMeta ?? (await WordsGameMeta.findOne({ where: { gameId: game.gameId } }));
        const wordsOutline = providedData?.wordsOutline ?? (await outline.findOne({ gameId: game.gameId }));
        wordsMeta?.strikes != null && (strikeLimit = wordsMeta.strikes);
        wordsMeta?.winnersCap != null && (winnersCap = wordsMeta.winnersCap);
        wordsMeta?.maxLives != null && (maxLives = wordsMeta.maxLives);
        const wheelItem = wordsOutline?.outline.find(o => o.itemType === 'wheel');
        if (wheelItem?.letters) {
            wheelLetters = wheelItem.letters.join('');
        }
        if (wordsMeta?.superWheelEnabled) {
            superWheelItems = providedData?.superWheelItems ?? (await SuperWheelItem.findAll());
        }
    }
    
    const season = providedData?.season ?? (await getSeason()); 
    const rGameObj: RedisGameInfo = {
        gameId: game.gameId.toString(),
        broadcastId: broadcastId.toString(),
        rehearsal: rehearsal.toString(),
        forReal: forReal.toString(),
        liveConfigId: liveConfigId?.toString(),
        showType: game.showType,
        gameType: show.gameType,
        startActual: new Date().toISOString(),
        prizeCents: (game.prizeCents ?? 0).toString(),
        prizePoints: (game.prizePoints ?? 0).toString(),
        splitCents: game.splitCents?.toString(),
        splitPoints: game.splitPoints?.toString(),
        questionNumber: '0',
        questionCount: questionCount.toString(),
        seasonEnabled: (+!!season).toString(),
        winnersCap: winnersCap?.toString(),
        maxLives: maxLives?.toString(),
        maxErasers: maxErasers?.toString(),
        strikeLimit: strikeLimit?.toString(),
        wheelLetters: wheelLetters?.toUpperCase(),
        superWheelItems: JSON.stringify(superWheelItems)
    }

    await redis.multi()
        .set(rGameKey(broadcastId).gameActiveFlag, 1)
        .hSet(rGameKey(broadcastId).gameInfo, Object.entries(rGameObj).filter(([, v]) => v != null)) // filter undefined from object as it causes redis error
        .exec();
    return rGameObj;
}

export default createRedisGameInfo;
