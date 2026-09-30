import Schedule from '../../common/database/eventModels/schedule';
import Game from '../../common/database/eventModels/game';
import Show from '../../common/database/configModels/show';
import redis from '../../common/redisClient';
import logger from '../../common/logger';
import ApiShowLive from '../models/ApiShowLive';
import ApiShow from '../models/ApiShow';
import ApiShowDisplay from '../models/ApiShowDisplay';
import Broadcast from '../../common/database/eventModels/broadcast';
import LiveConfig from '../../common/database/configModels/liveConfig';
import getLiveConfig, { getLiveConfigById } from './getLiveConfig';
import rKey from '../../common/redisKeys';
import rGameKey from '../../websocket/wsTypes/redisGameKeys';
import { Op } from 'sequelize';
import { outline } from '../../common/mongoClient';
import TriviaGameMeta from '../../common/database/eventModels/triviaGameMeta';
import WordsGameMeta from '../../common/database/eventModels/wordsGameMeta';
import { all } from 'better-all';
import { getCachedTriviaGameMeta, getCachedWordsGameMeta } from '../../common/utils/gameDataCache';

async function getSchedule(scheduleType: 'normal' | 'rehearsal' | 'all', forceRefresh: boolean = false) {
    if (!forceRefresh) {
        const cached = await redis.json.get(rKey.schedule(scheduleType));
        if (cached) return cached as unknown as ApiShow[];
    }

    const { allShows, scheduledShows, liveConfigFalse, liveConfigTrue } = await all({
        async allShows() { return Show.findAll({ order: [['order', 'ASC']] }); },
        async scheduledShows() { return Schedule.findAll({ where: { ...scheduleType == 'all' ? {} : { rehearsal: scheduleType != 'normal' } } }); },
        async liveConfigFalse() { return getLiveConfig(false); },
        async liveConfigTrue() { return getLiveConfig(true); }
    });

    const scheduledGameIds = scheduledShows.map(s => s.gameId);
    const { scheduledGames, activeBroadcasts } = await all({
        async scheduledGames() { return Game.findAll({ where: { gameId: { [Op.in]: scheduledGameIds } } }); },
        async activeBroadcasts() { return Broadcast.findAll({ where: { ended: null, ...scheduleType == 'all' ? {} : { rehearsal: scheduleType != 'normal' } } }); }
    });
    
    const broadcastGameInfos = await Promise.all(
        activeBroadcasts.map(async (b) => {
            const gameInfo = await redis.hGetAll(rGameKey(b.broadcastId).gameInfo);
            return { broadcast: b, liveConfigId: gameInfo.liveConfigId ? +gameInfo.liveConfigId : null };
        })
    );
    
    const uniqueLiveConfigIds = [...new Set(broadcastGameInfos.map(b => b.liveConfigId).filter((id): id is number => id != null))];
    const liveConfigsById = new Map();
    if (uniqueLiveConfigIds.length > 0) {
        const liveConfigs = await LiveConfig.findAll({ where: { id: { [Op.in]: uniqueLiveConfigIds } } });
        liveConfigs.forEach(config => {
            liveConfigsById.set(config.id, {
                socketUrl: config.socketUrl,
                source: config.source,
                passthrough: config.passthrough,
                high: config.high,
                medium: config.medium,
                low: config.low,
                playlistUrl: config.playlistUrl
            });
        });
    }
    const liveConfigsByRehearsal = {
        [0]: liveConfigFalse,
        [1]: liveConfigTrue
    };
    
    const visibleScheduledShows = scheduledShows.filter(s => s.visible);
    const visibleGameIds = visibleScheduledShows.map(s => s.gameId);
    
    const { gameOutlines, triviaGameMetas, wordsGameMetas } = await all({
        async gameOutlines() {
            if (visibleGameIds.length === 0) return [];
            return outline.find({ gameId: { $in: visibleGameIds } }).exec();
        },
        async triviaGameMetas() {
            if (visibleGameIds.length === 0) return [];
            const metas = await Promise.all(visibleGameIds.map(id => getCachedTriviaGameMeta(id.toString())));
            return metas.filter((m): m is NonNullable<typeof metas[0]> => m !== null);
        },
        async wordsGameMetas() {
            if (visibleGameIds.length === 0) return [];
            const metas = await Promise.all(visibleGameIds.map(id => getCachedWordsGameMeta(id.toString())));
            return metas.filter((m): m is NonNullable<typeof metas[0]> => m !== null);
        }
    });
    
    const outlineMap = new Map(gameOutlines.map(o => [o.gameId, o]));
    const triviaMetaMap = new Map(triviaGameMetas.map((m: any) => [m.gameId, m]));
    const wordsMetaMap = new Map(wordsGameMetas.map((m: any) => [m.gameId, m]));
    
    // Create a map of broadcastId to liveConfigId for quick lookup
    const broadcastLiveConfigMap = new Map(broadcastGameInfos.map(b => [b.broadcast.broadcastId, b.liveConfigId]));
    
    // Use Maps for O(1) lookups instead of O(n) .find() calls
    const gameMap = new Map(scheduledGames.map(g => [g.gameId, g]));
    const showMap = new Map(allShows.map(s => [s.showType, s]));
    const broadcastMap = new Map(activeBroadcasts.map(b => [`${b.gameId}:${b.rehearsal}`, b]));
    
    const schedule: ApiShow[] = [];
    const scheduleEntries = visibleScheduledShows.map(sched => {
        const game = gameMap.get(sched.gameId);
        const show = game ? showMap.get(game.showType) : undefined;
        if (!game || !show) {
            return null;
        }
        const gameOutline = outlineMap.get(sched.gameId);
        let gameMeta = { unbounded: false };
        const checkpoints = gameOutline?.outline.filter(o => o.itemType == "checkpoint");
        const prizeCents = checkpoints?.reduce((acc, cp) => acc + (cp.prizeCents ?? 0), 0) ?? 0;
        const prizePoints = checkpoints?.reduce((acc, cp) => acc + (cp.prizePoints ?? 0), 0) ?? 0;

        if (show.gameType === 'trivia') {
            const meta = triviaMetaMap.get(sched.gameId) as TriviaGameMeta | undefined;
            gameMeta = { unbounded: meta?.winnersCap == 1 ? true : false };
        } else if (show.gameType === 'words') {
            const meta = wordsMetaMap.get(sched.gameId) as WordsGameMeta | undefined;
            gameMeta = { unbounded: meta?.winnersCap == 1 ? true : false };
        }
        let liveData;
        const broadcast = broadcastMap.get(`${sched.gameId}:${sched.rehearsal}`);
        if (broadcast) {
            // live now - use stored liveConfigId from Redis if available, otherwise fall back to old method
            const liveConfigId = broadcastLiveConfigMap.get(broadcast.broadcastId);
            let liveConfig;
            if (liveConfigId != null) {
                liveConfig = liveConfigsById.get(liveConfigId);
                if (!liveConfig) {
                    logger.error(`LiveConfig not found for broadcast ${broadcast.broadcastId} with liveConfigId ${liveConfigId}`);
                    // Fall back to old method if liveConfigId doesn't exist
                    liveConfig = liveConfigsByRehearsal[broadcast.rehearsal as (0 | 1)];
                }
            } else {
                // Old broadcast without liveConfigId - use old method
                liveConfig = liveConfigsByRehearsal[broadcast.rehearsal as (0 | 1)];
            }
            
            if (liveConfig) {
                liveData = new ApiShowLive(
                    broadcast.broadcastId,
                    show.gameKey,
                    liveConfig.socketUrl + '/ws/' + broadcast.broadcastId + '?universal',
                    liveConfig.source,
                    liveConfig.passthrough,
                    liveConfig.high,
                    liveConfig.medium,
                    liveConfig.low,
                    liveConfig.playlistUrl,
                    gameMeta.unbounded
                );
            }
        }

        let startTime: Date | undefined;
        if (sched.startTime) {
            startTime = sched.startTime;
        }
        
        let subtitle: string | undefined;
        if (sched.rehearsal) {
            subtitle = 'Rehearsal';
            if (sched.subtitle) {
                subtitle += ' - ' + sched.subtitle;
            }
        } else if (sched.subtitle) {
            subtitle = sched.subtitle;
        }
        const display = new ApiShowDisplay(show.title, show.summary, show.accentColor, show.description, show.logoUrl, show.bgImageUrl, show.bgVideoUrl, subtitle);
        return new ApiShow(
            game.gameId,
            show,
            display,
            sched.media ? JSON.parse(sched.media) : [],
            startTime,
            (game?.sumPrize == 1) ? ((game?.prizeCents+prizeCents) > 0 ? game.prizeCents+prizeCents : undefined) : (game?.prizeCents > 0 ? game.prizeCents : undefined),
            (game?.sumPrize == 1) ? ((game?.prizePoints+prizePoints) > 0 ? game.prizePoints+prizePoints : undefined) : (game?.prizePoints > 0 ? game.prizePoints : undefined),
            liveData
        );
    });
    schedule.push(...scheduleEntries.filter((entry): entry is ApiShow => entry != null));
    // Use Set for O(1) lookup instead of O(n) filter
    const scheduledShowTypes = new Set(scheduledGames.map(g => g.showType));
    schedule.push(
        ...allShows.flatMap(show => {
            if (scheduledShowTypes.has(show.showType)) {
                return [];
            }
            if (!show.alwaysVisible) {
                return [];
            }
            // show as airing soon
            const display = new ApiShowDisplay(show.title, show.summary, show.accentColor, show.description, show.logoUrl, show.bgImageUrl, show.bgVideoUrl);
            return new ApiShow(-1, show, display);
        })
    );
    schedule.sort((a, b) => {
        // If one show is live and the other is not, prioritize the live show
        if (a.live && !b.live) return -1;
        if (!a.live && b.live) return 1;

        // If both shows are live or both are not live, sort by start time
        if (a.startTime && b.startTime) {
            return a.startTime.getTime() - b.startTime.getTime();
        }
        // If only one show has a start time, prioritize that one
        if (a.startTime && !b.startTime) return -1;
        if (!a.startTime && b.startTime) return 1;

        // If neither show has a start time, consider them equal
        return 0;
    });
    logger.info(`Schedule refreshed. ScheduleType=${scheduleType}`);
    await all({
        async cacheSchedule() {
            return redis.json.set(rKey.schedule(scheduleType), '$', JSON.parse(JSON.stringify(schedule)));
        },
        async setLastEdited() {
            return redis.set(rKey.scheduleLastEdited, new Date().toISOString());
        }
    });
    return schedule;
}

export default getSchedule;
