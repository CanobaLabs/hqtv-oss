import { all } from 'better-all';
import Show from '../../common/database/configModels/show';
import Broadcast from '../../common/database/eventModels/broadcast';
import Game from '../../common/database/eventModels/game';
import LiveConfig from '../../common/database/configModels/liveConfig';
import TriviaGameMeta from '../../common/database/eventModels/triviaGameMeta';
import WordsGameMeta from '../../common/database/eventModels/wordsGameMeta';
import SuperWheelItem from '../../common/database/featureModels/superWheelItem';
import HqError from '../../common/hqError';
import getGameInfo from '../helpers/getGameInfo';
import replicateCheckpointsToRedis from '../helpers/replicateCheckpointsToRedis';
import replicatePuzzlesToRedis from '../helpers/replicatePuzzlesToRedis';
import replicateQuestionsToRedis from '../helpers/replicateQuestionsToRedis';
import { addExistingSurveyQuestions } from '../helpers/replicateSurveysToRedis';
import sendDiscordPrompter from '../helpers/sendDiscordPrompter';
import makeScheduleLive from '../helpers/startShowHelpers/makeScheduleLive';
import RedisPuzzle from '../redisSchemas/redisPuzzle';
import RedisQuestion from '../redisSchemas/redisQuestion';
import { wsServers } from '../wsServers';
import DiscordPrompt from '../wsTypes/DiscordPrompt';
import createRedisGameInfo from './createRedisGameInfo';
import getSeason from '../../api/utils/getSeason';
import { getCachedOutline, getCachedTriviaGameMeta, getCachedWordsGameMeta, getCachedSuperWheelItems, getCachedGame } from '../../common/utils/gameDataCache';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';

async function startGame(gameIdStr: string, intents: { rehearsal: unknown; forReal: unknown; restart: unknown; liveConfig: unknown; }) {
    if (intents.rehearsal == null || intents.forReal == null) {
        throw new HqError('must specify `rehearsal` and `forReal`', 0, 400);
    }
    if (intents.liveConfig == null) {
        throw new HqError('must specify `liveConfig`', 0, 400);
    }
    
    const liveConfigId = +intents.liveConfig;
    if (isNaN(liveConfigId)) {
        throw new HqError('liveConfig must be a valid number', 0, 400);
    }
    
    const { game, broadcast } = await all({
        async game() { return getCachedGame(gameIdStr); },
        async broadcast() { return Broadcast.findOne({ where: { ended: null } }); }
    });
    
    if (!game) {
        throw new HqError('game not found', 0, 404);
    }
    if (broadcast && !intents.restart) {
        throw new HqError(`there is already a game running. gameId=${broadcast.gameId}`, 0, 400);
    }

    const { liveConfig, show, gameOutlineRaw, season, triviaMeta, wordsMeta, superWheelItems } = await all({
        async liveConfig() { return LiveConfig.findByPk(liveConfigId); },
        async show() { return Show.findOne({ where: { showType: game.showType } }); },
        async gameOutlineRaw() { return getCachedOutline(game.gameId); },
        async season() { return getSeason(); },
        async triviaMeta() { 
            return getCachedTriviaGameMeta(game.gameId.toString());
        },
        async wordsMeta() { 
            return getCachedWordsGameMeta(game.gameId.toString());
        },
        async superWheelItems() {
            const meta = await this.$.wordsMeta;
            const showType = await this.$.show;
            if (showType?.gameType === 'words' && meta?.superWheelEnabled) {
                return getCachedSuperWheelItems();
            }
            return undefined;
        }
    });
    
    if (!liveConfig) {
        throw new HqError('liveConfig not found', 0, 404);
    }

    const gameOutline: { outline: any[] } = gameOutlineRaw ?? { outline: [] };
    const { gameId } = game;
    const newBroadcast = broadcast ?? await Broadcast.create({ gameId, rehearsal: intents.rehearsal, forReal: intents.forReal });
    const { broadcastId } = newBroadcast;
    
    // Cache the broadcast immediately (fire and forget)
    const broadcastData = newBroadcast.toJSON ? newBroadcast.toJSON() : newBroadcast;
    redis.set(rKey.broadcast(broadcastId), JSON.stringify(broadcastData)).catch(() => {});
    
    try {
        let rQuestions: RedisQuestion[] | RedisPuzzle[] = [];
        
        if (show?.gameType == 'trivia') {
            const { questions, checkpoints, surveys } = await all({
                async questions() {
                    return replicateQuestionsToRedis(broadcastId, { gameId }, gameOutline);
                },
                async checkpoints() {
                    return replicateCheckpointsToRedis(broadcastId, gameId, gameOutline);
                },
                async surveys() {
                    return addExistingSurveyQuestions(broadcastId, { gameId }, gameOutline);
                }
            });
            rQuestions = questions;
        } else if (show?.gameType == 'words') {
            const { puzzles, surveys } = await all({
                async puzzles() {
                    return replicatePuzzlesToRedis(broadcastId, { gameId }, gameOutline);
                },
                async surveys() {
                    return addExistingSurveyQuestions(broadcastId, { gameId }, gameOutline);
                }
            });
            rQuestions = puzzles;
        } else {
            await addExistingSurveyQuestions(broadcastId, { gameId }, gameOutline);
        }
        
        await createRedisGameInfo(
            game, 
            show!, 
            broadcastId, 
            +intents.rehearsal, 
            +intents.forReal, 
            rQuestions.length, 
            liveConfigId,
            {
                triviaMeta,
                wordsMeta: wordsMeta ? { 
                    strikes: wordsMeta.strikes, 
                    winnersCap: wordsMeta.winnersCap, 
                    maxLives: wordsMeta.maxLives, 
                    superWheelEnabled: !!wordsMeta.superWheelEnabled 
                } : null,
                wordsOutline: show?.gameType === 'words' ? gameOutline : null,
                season,
                superWheelItems
            }
        );
        
        if (intents.restart) {
            wsServers[broadcastId]?.wss.clients.forEach(c => c.terminate());
            const gameInfo = await getGameInfo(broadcastId);
            sendDiscordPrompter([
                new DiscordPrompt(gameInfo, 'now', 'Game restarted').embed,
                new DiscordPrompt(gameInfo, 'now').gameStarted()
            ]);
            return gameInfo;
        } else {
            const rehearsal = !!+(intents.rehearsal as number | string);
            const { gameInfo } = await all({
                async gameInfo() {
                    return getGameInfo(broadcastId);
                },
                async makeScheduleLive() {
                    return makeScheduleLive(gameId, rehearsal, gameOutline);
                }
            });
            sendDiscordPrompter([
                new DiscordPrompt(gameInfo, 'now').gameStarted()
            ]);
            return gameInfo;
        }
    } catch (err) {
        // fail? end game
        await Broadcast.update({ ended: new Date() }, { where: { broadcastId } });
        // Invalidate broadcast cache after update
        const { invalidateBroadcastCache } = await import('../../common/utils/gameDataCache');
        invalidateBroadcastCache(broadcastId).catch(() => {});
        throw err;
    }
}

export default startGame;
