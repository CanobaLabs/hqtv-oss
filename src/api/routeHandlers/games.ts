import axios from 'axios';
import { all } from 'better-all';
import Show from '../../common/database/configModels/show';
import Broadcast from '../../common/database/eventModels/broadcast';
import Game from '../../common/database/eventModels/game';
import Production from '../../common/database/eventModels/production';
import Schedule from '../../common/database/eventModels/schedule';
import TriviaGameMeta from '../../common/database/eventModels/triviaGameMeta';
import WordsGameMeta from '../../common/database/eventModels/wordsGameMeta';
import Win from '../../common/database/userModels/win';
import HqError from '../../common/hqError';
import { outline } from '../../common/mongoClient';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import getSchedule from '../utils/generateSchedule';
import getLiveConfig from '../utils/getLiveConfig';
import { featureDb } from '../../common/database/connections';
import Audit from '../../common/database/adminModels/audit';
import centsToDollars from '../../common/utils/centsToDollars';
import { commandOptions } from 'redis';
import getDiscordUser from '../utils/getDiscordUser';
import logger from '../../common/logger';
import { broadcastOutlineChatMessage } from '../websocket/outlineCollaboration/server';
import { BaseChatMessage } from '../../common/types/chatMessage';
import { OutlineChatMessage } from '../websocket/outlineCollaboration/types';
import { Op } from 'sequelize';
import { calculateEmployeePermissionSets } from './employees';
import { invalidateTriviaGameMetaCache, invalidateWordsGameMetaCache, invalidateOutlineCache, getCachedTriviaGameMeta, getCachedWordsGameMeta, getCachedGame, getCachedOutline } from '../../common/utils/gameDataCache';

export async function getGame(gameIdStr?: string) {
	// Handle "all" case - cache list queries
	if (gameIdStr === "all") {
		// Check cache
		const cached = await redis.get(rKey.apGameAll);
		if (cached) {
			return JSON.parse(cached);
		}
		
	const games = await Game.findAll({ limit: 100, order: [['created', 'DESC']], raw: true });
	
	// Cache the result (no expiration - cache forever)
	// Don't await - fire and forget to avoid blocking the response
	redis.set(rKey.apGameAll, JSON.stringify(games)).catch(() => {});
	
	// Return plain objects to match cached format
	return games;
	}
	
	// Check cache for single game
	if (gameIdStr) {
		const cached = await redis.get(rKey.apGame(gameIdStr));
		if (cached) {
			return JSON.parse(cached);
		}
	}
	
	const game = await Game.findOne({ where: { gameId: gameIdStr }, raw: true });
	if (!game) throw new HqError('Game not found.', 0, 404);
	
	// Cache the game (no expiration - cache forever)
	if (gameIdStr) {
		// raw: true returns plain object directly, no conversion needed
		// Don't await - fire and forget to avoid blocking the response
		redis.set(rKey.apGame(gameIdStr), JSON.stringify(game)).catch(() => {});
		// Return plain object to match cached format
		return game;
	}
	
	return game;
}

export async function createGame(gameIdStr: string, employeeId: string, body: { [k: string]: unknown; }) {
    const game = await Game.findOne({ where: { gameId: gameIdStr } });
    if (Number.isNaN(+gameIdStr)) throw new HqError('Invalid game ID', 0, 400);
    if (game) throw new HqError('Game already exists.', 0, 404);
    const show = await Show.findOne({ where: { showType: body.showType } });
    if (!show) throw new HqError('Invalid show type', 0, 400);
    await Game.create({
        gameId: +gameIdStr,
        showType: body.showType,
        prizeCents: body?.prizeCents ?? 0,
        prizePoints: body?.prizePoints ?? 0,
    });
    await Production.create({
        id: +gameIdStr,
        createdBy: employeeId,
        hosts: employeeId,
        writers: employeeId,
        producers: employeeId,
    });
    if (show.gameType === 'trivia') {
        const triviaMeta = await TriviaGameMeta.create({ gameId: gameIdStr });
        // Cache the new meta (fire and forget)
        const metaData = triviaMeta.toJSON ? triviaMeta.toJSON() : triviaMeta;
        redis.set(rKey.triviaGameMeta(gameIdStr), JSON.stringify(metaData)).catch(() => {});
    } else if (show.gameType === 'words') {
        const wordsMeta = await WordsGameMeta.create({ gameId: gameIdStr });
        // Cache the new meta (fire and forget)
        const metaData = wordsMeta.toJSON ? wordsMeta.toJSON() : wordsMeta;
        redis.set(rKey.wordsGameMeta(gameIdStr), JSON.stringify(metaData)).catch(() => {});
    }
    const { cacheOutline } = await import('../../common/utils/gameDataCache');
    const existingOutline = await outline.findOne({ gameId: +gameIdStr }).exec();
    if (!existingOutline) {
        await outline.create({ gameId: +gameIdStr, outline: [] });
        // Cache empty outline (fire and forget)
        cacheOutline(+gameIdStr, { outline: [] }).catch(() => {});
    }
    await Audit.create({
        to: gameIdStr,
        toType: 'game',
        from: employeeId,
        fromType: 'employee',
        action: 'create_game',
        description: 'Created game'
    });
    
    // Invalidate cache for this game, production (since Production is created with the game), and the "all" games list
    await Promise.all([
        redis.del(rKey.apGame(gameIdStr)),
        redis.del(rKey.apGameProduction(gameIdStr)),
        redis.del(rKey.apGameAll)
    ]);
    
    return {};
}

export async function updateGame(gameIdStr: string, requestingEmployeeId: string, body: { [k: string]: unknown; }) {
	const { game, gameOutline, show, showBefore } = await all({
        async game() { return getCachedGame(gameIdStr); },
        async gameOutline() { return getCachedOutline(+gameIdStr); },
        async show() {
            return body.showType ? Show.findOne({ where: { showType: body.showType } }) : null;
        },
        async showBefore() {
            const gameResult = await this.$.game;
            if (!gameResult) return null;
            return Show.findOne({ where: { showType: gameResult.showType } });
        }
    });
    if (!game) throw new HqError('Game not found.', 0, 404);
    
    if (body.showType && !show) throw new HqError('Invalid game type', 0, 400);
    if (
        (body?.prizeCents && typeof body?.prizeCents != "number") ||
        (body?.prizePoints && typeof body?.prizePoints != "number") ||
        ('sumPrize' in body && typeof body.sumPrize !== "number") ||
        ('splitCents' in body && typeof body.splitCents !== "number") ||
        ('splitPoints' in body && typeof body.splitPoints !== "number")
    ) throw new HqError('Prizecents, prizepoints, sumPrize, splitCents, and splitPoints must be numbers', 0, 400);
    if ('sumPrize' in body && ![0, 1].includes(body.sumPrize as number)) throw new HqError('sumPrize must be 0 or 1', 0, 400);
    if ('splitCents' in body && ![0, 1].includes(body.splitCents as number)) throw new HqError('splitCents must be 0 or 1', 0, 400);
    if ('splitPoints' in body && ![0, 1].includes(body.splitPoints as number)) throw new HqError('splitPoints must be 0 or 1', 0, 400);
    
    const outlineData = gameOutline ?? { outline: []};
    const outlinePuzzles = outlineData.outline.filter((o: { itemType?: string | null }) => o.itemType == 'puzzle');
    const outlineQuestions = outlineData.outline.filter((o: { itemType?: string | null }) => o.itemType == 'question');
    if (body.showType && showBefore && showBefore.gameType != show!.gameType) {
        if (outlinePuzzles.length > 0 && show!.gameType != 'words') {
            throw new HqError('Cannot change to a non-words game type when there are puzzles in the outline', 0, 400);
        }
        if (outlineQuestions.length > 0 && show!.gameType != 'trivia') {
            throw new HqError('Cannot change to a non-trivia game type when there are questions in the outline', 0, 400);
        }
    }
    // Collect audit entries to batch create
    const auditEntries = [];
    if (body.showType && game.showType != body.showType) {
        auditEntries.push({
            to: gameIdStr,
            toType: 'game' as const,
            from: requestingEmployeeId,
            fromType: 'employee' as const,
            action: 'edit_showType' as const,
            description: 'Changed showtype from `' + game.showType + '` to `' + body.showType + '`'
        });
    }
    if (body.prizeCents && game.prizeCents != body.prizeCents) {
        auditEntries.push({
            to: gameIdStr,
            toType: 'game' as const,
            from: requestingEmployeeId,
            fromType: 'employee' as const,
            action: 'edit_prizeCents' as const,
            description: 'Changed cash prize from `' + centsToDollars(game.prizeCents) + '` to `' + centsToDollars(body.prizeCents as number) + '`'
        });
    }
    if (body.prizePoints && game.prizePoints != body.prizePoints) {
        auditEntries.push({
            to: gameIdStr,
            toType: 'game' as const,
            from: requestingEmployeeId,
            fromType: 'employee' as const,
            action: 'edit_prizePoints' as const,
            description: 'Changed point prize from `' + (game.prizePoints ?? 0).toLocaleString("en-US") + '` to `' + (body.prizePoints as number).toLocaleString("en-US") + '`'
        });
    }
    if ('sumPrize' in body && game.sumPrize != body.sumPrize) {
        auditEntries.push({
            to: gameIdStr,
            toType: 'game' as const,
            from: requestingEmployeeId,
            fromType: 'employee' as const,
            action: 'edit_sumPrize' as const,
            description: 'Changed sumPrize from `' + game.sumPrize + '` to `' + (body.sumPrize as number) + '`'
        });
    }
    if ('splitCents' in body && game.splitCents != body.splitCents) {
        auditEntries.push({
            to: gameIdStr,
            toType: 'game' as const,
            from: requestingEmployeeId,
            fromType: 'employee' as const,
            action: 'edit_splitCents' as const,
            description: 'Changed splitCents from `' + game.splitCents + '` to `' + (body.splitCents as number) + '`'
        });
    }
    if ('splitPoints' in body && game.splitPoints != body.splitPoints) {
        auditEntries.push({
            to: gameIdStr,
            toType: 'game' as const,
            from: requestingEmployeeId,
            fromType: 'employee' as const,
            action: 'edit_splitPoints' as const,
            description: 'Changed splitPoints from `' + game.splitPoints + '` to `' + (body.splitPoints as number) + '`'
        });
    }
    
    // Parallelize Game update, Audit creates, and cache refresh
    await Promise.all([
        Game.update({
            showType: body?.showType ?? undefined,
            prizeCents: body?.prizeCents ?? undefined,
            prizePoints: body?.prizePoints ?? undefined,
            sumPrize: body?.sumPrize ?? undefined,
            splitCents: body?.splitCents ?? undefined,
            splitPoints: body?.splitPoints ?? undefined,
            opt: body?.opt ?? undefined
        }, { where: { gameId: gameIdStr } }).then(async () => {
            // Refresh game cache with updated value (fire and forget)
            const updatedGame = await Game.findOne({ where: { gameId: gameIdStr }, raw: true });
            if (updatedGame) {
                redis.set(rKey.apGame(gameIdStr), JSON.stringify(updatedGame)).catch(() => {});
            }
        }),
        ...auditEntries.map(entry => Audit.create(entry)),
        redis.del(rKey.apGameAll)
    ]);
    // Parallelize schedule generation since they're independent
    await Promise.all([
        getSchedule('normal', true),
        getSchedule('rehearsal', true),
        getSchedule('all', true)
    ]);
    return {};
}

export async function deleteGame(gameIdStr: string, employeeId: string) {
    const game = await Game.findOne({ where: { gameId: gameIdStr } });
    if (!game) throw new HqError('Game not found', 0, 404);
    
    // Check if there are any wins associated with this game
    const win = await Win.findOne({ where: { gameId: gameIdStr } });
    if (win) throw new HqError('Cannot delete a game that has wins associated with it', 0, 400);
    
    const gameOutline = await outline.findOne({ gameId: +gameIdStr }) ?? { outline: []};
    const invalidItemTypes = new Set(["question", "puzzle"]);
    if (gameOutline.outline.some(o => invalidItemTypes.has(o.itemType!))) {
        throw new HqError('Cannot delete a game that has puzzles or questions', 0, 400);
    }
    
    // Delete broadcasts if they exist (game has aired)
    const broadcasts = await Broadcast.findAll({ where: { gameId: gameIdStr } });
    const broadcastIds = broadcasts.map(b => b.broadcastId);
    
    await Promise.all([
        Game.destroy({ where: { gameId: gameIdStr }, limit: 1 }),
        TriviaGameMeta.destroy({ where: { gameId: gameIdStr }, limit: 1 }),
        WordsGameMeta.destroy({ where: { gameId: gameIdStr }, limit: 1 }),
        Production.destroy({ where: { id: gameIdStr }, limit: 1 }),
        Schedule.destroy({ where: { gameId: gameIdStr }, limit: 1 }),
        Broadcast.destroy({ where: { gameId: gameIdStr } }),
        Audit.create({
            to: gameIdStr,
            toType: 'game',
            from: employeeId,
            fromType: 'employee',
            action: 'delete_game',
            description: 'Deleted game' + (broadcasts.length > 0 ? ` and ${broadcasts.length} associated broadcast(s)` : '')
        })
    ]);
    
    // Invalidate all caches for this game, broadcasts, and the "all" games list
    const { invalidateBroadcastCache } = await import('../../common/utils/gameDataCache');
    await Promise.all([
        redis.del(rKey.apGame(gameIdStr)),
        redis.del(rKey.apGameSchedule(gameIdStr)),
        redis.del(rKey.apGameProduction(gameIdStr)),
        redis.del(rKey.apGameWins(gameIdStr)),
        redis.del(rKey.apGameAll),
        invalidateOutlineCache(+gameIdStr),
        invalidateTriviaGameMetaCache(gameIdStr),
        invalidateWordsGameMetaCache(gameIdStr),
        ...broadcastIds.map(id => invalidateBroadcastCache(id))
    ]);
    // Parallelize schedule generation since they're independent
    await Promise.all([
        getSchedule('normal', true),
        getSchedule('rehearsal', true),
        getSchedule('all', true)
    ]);
    return {};
}

export async function scheduleGame(gameIdStr: string, employeeId: string, body: { [k: string]: unknown; }) {
    const { game, gameOutlineRaw } = await all({
        async game() { return getCachedGame(gameIdStr); },
        async gameOutlineRaw() { return getCachedOutline(+gameIdStr); }
    });
    if (!game) throw new HqError('Game not found.', 0, 404);
    const gameOutline = gameOutlineRaw ?? { outline: [] };
    const mediaQuestions = gameOutline.outline.filter(o => o.itemType == "question" && o.media);
    const newSchedule = await Schedule.create({
        gameId: gameIdStr,
        rehearsal: body.rehearsal ?? 0,
        startTime: body.startTime ?? null,
        subtitle: body.subtitle ?? undefined,
        visible: body.visible ?? 1,
        autoVisible: body.autoVisible ?? 1,
        media: (mediaQuestions.length > 0) ? JSON.stringify(mediaQuestions.map(q => {
            return {
                hash: q.media?.hash ?? '',
                mediaId: q.media?.mediaId ?? '',
                mediaUrl: q.media?.mediaUrl ?? '',
                size: q.media?.size ?? 0,
            }
        })) : undefined,
    });
    await Audit.create({
        to: gameIdStr,
        toType: 'game',
        subTo: newSchedule.itemId.toString(),
        subToType: 'schedule',
        from: employeeId,
        fromType: 'employee',
        action: 'schedule_game',
        description: `Scheduled ${(body.rehearsal ?? 0) ? "rehearsal" : "normal"} game for ${new Date(newSchedule.startTime!).toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' })}`
    });
    
    // Invalidate schedule cache
    await redis.del(rKey.apGameSchedule(gameIdStr));
    
    // Parallelize schedule generation since they're independent
    await Promise.all([
        getSchedule('normal', true),
        getSchedule('rehearsal', true),
        getSchedule('all', true)
    ]);
    return newSchedule.itemId.toString();
}

export async function getScheduledGame(gameIdStr: string) {
    // Check cache
    const cached = await redis.get(rKey.apGameSchedule(gameIdStr));
    if (cached) {
        return JSON.parse(cached);
    }
    
    const game = await Schedule.findAll({ where: { gameId: gameIdStr }, raw: true });
    
    // Cache the result (no expiration - cache forever)
    // Don't await - fire and forget to avoid blocking the response
    redis.set(rKey.apGameSchedule(gameIdStr), JSON.stringify(game)).catch(() => {});
    
    // Return plain objects to match cached format
    return game;
}

export async function getMetaForGame(gameIdStr: string) {
	const { game, show, triviaMeta, wordsMeta } = await all({
        async game() { return getCachedGame(gameIdStr); },
        async show() {
            const gameResult = await this.$.game;
            if (!gameResult) return null;
            return Show.findOne({ where: { showType: gameResult.showType } });
        },
        async triviaMeta() { return getCachedTriviaGameMeta(gameIdStr); },
        async wordsMeta() { return getCachedWordsGameMeta(gameIdStr); }
    });
    
    if (!game) throw new HqError('Game not found.', 0, 404);
    if (!show) throw new HqError('Show type not found.', 0, 404);
    const meta = show.gameType === 'trivia' ? triviaMeta : wordsMeta;
    return meta;
}

export async function updateMetaForGame(gameIdStr: string, employeeId: string, body: { [k: string]: unknown; }) {
	const game = await Game.findOne({ where: { gameId: gameIdStr } });
    if (!game) throw new HqError('Game not found.', 0, 404);
    
    // Parallelize show and meta queries
    const [show, triviaMeta, wordsMeta] = await Promise.all([
        Show.findOne({ where: { showType: game.showType } }),
        TriviaGameMeta.findOne({ where: { gameId: gameIdStr } }),
        WordsGameMeta.findOne({ where: { gameId: gameIdStr } })
    ]);
    
    if (!show) throw new HqError('Show type not found.', 0, 404);
    const meta = show.gameType === 'trivia' ? triviaMeta : wordsMeta;
    if (!meta) throw new HqError('Meta not found.', 0, 404);
    
    // Collect audit entries
    const auditEntries = [];
    if (body.maxLives && meta.maxLives != body.maxLives) {
        auditEntries.push({
            to: gameIdStr,
            toType: 'game' as const,
            from: employeeId,
            fromType: 'employee' as const,
            action: 'change_meta_maxLives' as const,
            description: `Changed Maximum Lives from \`${meta.maxLives}\` to \`${body.maxLives}\``
        });
    }
    if (body.maxErasers && 'maxErasers' in meta && meta.maxErasers != body.maxErasers) {
        auditEntries.push({
            to: gameIdStr,
            toType: 'game' as const,
            from: employeeId,
            fromType: 'employee' as const,
            action: 'change_meta_maxErases' as const,
            description: `Changed Maximum Erasers from \`${meta.maxErasers}\` to \`${body.maxErasers}\``
        });
    }
    if ('winnersCap' in body && meta.winnersCap != body.winnersCap) {
        auditEntries.push({
            to: gameIdStr,
            toType: 'game' as const,
            from: employeeId,
            fromType: 'employee' as const,
            action: 'change_meta_winnersCap' as const,
            description: `Changed Winners Cap from \`${meta.winnersCap}\` to \`${body.winnersCap}\``
        });
    }
    if (body.strikes && 'strikes' in meta && meta.strikes != body.strikes) {
        auditEntries.push({
            to: gameIdStr,
            toType: 'game' as const,
            from: employeeId,
            fromType: 'employee' as const,
            action: 'change_meta_strikes' as const,
            description: `Changed Strikes from \`${meta.strikes}\` to \`${body.strikes}\``
        });
    }
    if (body.wheelLetters && 'wheelLetters' in meta && meta.wheelLetters != body.wheelLetters) {
        auditEntries.push({
            to: gameIdStr,
            toType: 'game' as const,
            from: employeeId,
            fromType: 'employee' as const,
            action: 'change_meta_wheelLetters' as const,
            description: `Changed Wheel Letters from \`${meta.wheelLetters}\` to \`${body.wheelLetters}\``
        });
    }
    if (body.superWheelEnabled !== undefined && 'superWheelEnabled' in meta && meta.superWheelEnabled != body.superWheelEnabled) {
        auditEntries.push({
            to: gameIdStr,
            toType: 'game' as const,
            from: employeeId,
            fromType: 'employee' as const,
            action: 'change_meta_superWheelEnabled' as const,
            description: `${meta.superWheelEnabled ? "Enabled" : "Disabled"} Super Wheel`
        });
    }
    
    // Build update object for trivia meta
    const triviaUpdate: { maxLives?: number; maxErasers?: number; winnersCap?: number | null } = {};
    if ('maxLives' in body) triviaUpdate.maxLives = body.maxLives as number;
    if ('maxErasers' in body) triviaUpdate.maxErasers = body.maxErasers as number;
    if ('winnersCap' in body) triviaUpdate.winnersCap = body.winnersCap as number | null;
    
    // Build update object for words meta
    const wordsUpdate: { maxLives?: number; strikes?: number; wheelLetters?: string | null; superWheelEnabled?: number; winnersCap?: number | null } = {};
    if ('maxLives' in body) wordsUpdate.maxLives = body.maxLives as number;
    if ('strikes' in body) wordsUpdate.strikes = body.strikes as number;
    if ('wheelLetters' in body) wordsUpdate.wheelLetters = body.wheelLetters as string | null;
    if ('superWheelEnabled' in body) wordsUpdate.superWheelEnabled = body.superWheelEnabled as number;
    if ('winnersCap' in body) wordsUpdate.winnersCap = body.winnersCap as number | null;
    
    // Parallelize meta update, cache refresh, and audit creates
    await Promise.all([
        show.gameType == 'trivia' 
            ? TriviaGameMeta.update(triviaUpdate, { where: { gameId: gameIdStr } }).then(async () => {
                await invalidateTriviaGameMetaCache(gameIdStr);
                // Refresh cache with updated value
                const updatedMeta = await TriviaGameMeta.findOne({ where: { gameId: gameIdStr } });
                if (updatedMeta) {
                    const metaData = updatedMeta.toJSON ? updatedMeta.toJSON() : updatedMeta;
                    redis.set(rKey.triviaGameMeta(gameIdStr), JSON.stringify(metaData)).catch(() => {});
                }
            })
            : WordsGameMeta.update(wordsUpdate, { where: { gameId: gameIdStr } }).then(async () => {
                await invalidateWordsGameMetaCache(gameIdStr);
                // Refresh cache with updated value
                const updatedMeta = await WordsGameMeta.findOne({ where: { gameId: gameIdStr } });
                if (updatedMeta) {
                    const metaData = updatedMeta.toJSON ? updatedMeta.toJSON() : updatedMeta;
                    redis.set(rKey.wordsGameMeta(gameIdStr), JSON.stringify(metaData)).catch(() => {});
                }
            }),
        ...auditEntries.map(entry => Audit.create(entry))
    ]);
    return {};
}

export async function getWinsFromGame(gameIdStr: string) {
	// Check cache
	const cached = await redis.get(rKey.apGameWins(gameIdStr));
	if (cached) {
		return JSON.parse(cached);
	}
	
	const wins = await Win.findAll({
        where: { gameId: gameIdStr },
        order: [ ['winDate', 'DESC'] ],
        raw: true
    });
	
	// Cache the result (no expiration - cache forever)
	// Don't await - fire and forget to avoid blocking the response
	redis.set(rKey.apGameWins(gameIdStr), JSON.stringify(wins)).catch(() => {});
	
	// Return plain objects to match cached format
	return wins;
}

export async function getBroadcastForGame(gameIdStr: string) {
	const gameId = +gameIdStr;
	const broadcast = await Broadcast.findOne({ where: { gameId, ended: null }, order: [['started', 'DESC']], raw: true });
    if (!broadcast) {
		return null;
	}
    
    // Fetch live config - get liveConfigId from Redis if available, otherwise fall back to old method
    const redis = (await import('../../common/redisClient')).default;
    const rGameKey = (await import('../../websocket/wsTypes/redisGameKeys')).default;
    const gameInfo = await redis.hGetAll(rGameKey(broadcast.broadcastId).gameInfo);
    
    let liveConfig;
    if (gameInfo.liveConfigId) {
        const { getLiveConfigById } = await import('../utils/getLiveConfig');
        liveConfig = await getLiveConfigById(+gameInfo.liveConfigId);
    } else {
        // Fall back to old behavior for old broadcasts without liveConfigId
        liveConfig = await getLiveConfig(!!broadcast.rehearsal);
    }
    // raw: true returns plain object directly, no conversion needed
    const result = { ...broadcast, ...liveConfig };
    
    return result;
}

export async function getScheduleInfoForGame(gameIdStr: string) {
	// Check cache
	const cached = await redis.get(rKey.apGameSchedule(gameIdStr));
	if (cached) {
		return JSON.parse(cached);
	}
	
	const gameSchedule = await Schedule.findAll({ where: { gameId: gameIdStr }, raw: true });
	
	// Cache the result (no expiration - cache forever)
	// Schedule.findAll() always returns an array (never null), so we can safely cache it
	// Don't await - fire and forget to avoid blocking the response
	redis.set(rKey.apGameSchedule(gameIdStr), JSON.stringify(gameSchedule)).catch(() => {});
	
	// Return plain objects to match cached format
    return gameSchedule;
}

export async function getOutlineForGame(gameIdStr: string) {
	const gameOutline = await outline.findOne({ gameId: +gameIdStr }).exec();
    if (!gameOutline) return { outline: [] };
    return gameOutline;
}

export async function getLatestGameId() {
    // return the latest game id
    const game = await Game.findOne({ order: [['created', 'DESC']] }); // newest first
    if (!game) throw new HqError('Game not found.', 0, 404);
    return { gameId: game.gameId };
}

export async function getSchedulePageData() {
	// Get all games
	const games = await getGame('all');
	
	// Extract game IDs and show types
	const gameIds: string[] = games.map((g: any) => String(g.gameId));
	const showTypes: string[] = games
		.map((g: any) => g.showType)
		.filter((st: any): st is string => typeof st === 'string' && st.length > 0);
	
	// Get unique show types
	const uniqueShowTypes: string[] = Array.from(new Set(showTypes));
	
	// Import batch functions
	const { getProductionForGamesBatch } = await import('../routeHandlers/productions');
	const { getShowTypesBatch } = await import('../routeHandlers/adminPanel');
	
	// Batch fetch productions and shows
	const [productions, shows] = await Promise.all([
		getProductionForGamesBatch(gameIds),
		getShowTypesBatch(uniqueShowTypes)
	]);
	
	return {
		games,
		productions,
		shows
	};
}

const DISCORD_CDN_BASE_URL = 'https://cdn.discordapp.com';
const MAX_MESSAGE_LENGTH = 2000;

function getOutlineChatKey(gameId: number): string {
	return `game:${gameId}:outlineChat`;
}

function getDiscordAvatarUrl(userId: string, avatarId: string | null): string {
	if (avatarId) {
		const extension = avatarId.startsWith('a_') ? 'gif' : 'png';
		return `${DISCORD_CDN_BASE_URL}/avatars/${userId}/${avatarId}.${extension}`;
	}
	const defaultAvatarIndex = parseInt(userId) % 5;
	return `${DISCORD_CDN_BASE_URL}/embed/avatars/${defaultAvatarIndex}.png`;
}

function constructOutlineChat(data: BaseChatMessage): OutlineChatMessage {
	return {
		type: 'producerChat',
		messageId: data.messageId,
		employeeId: data.employeeId,
		employeeName: data.employeeName,
		avatarUrl: data.avatarUrl,
		message: data.message,
		edited: data.edited,
		editedBy: data.editedBy,
		editedAt: data.editedAt,
		originalMessageId: data.originalMessageId
	};
}

export async function getOutlineChat(gameIdStr: string = '0') {
	const gameId = +gameIdStr;
	if (!gameId || isNaN(gameId)) {
		return [];
	}

	const chatLog = await redis.xRead(commandOptions({ isolated: true }), [
		{
			key: getOutlineChatKey(gameId),
			id: '0-0'
		}], {
			COUNT: 1000
		});
	
	if (!chatLog?.[0]?.messages) return [];
	
	const messagesMap = new Map<string, {
		id: string;
		employeeId: string;
		employeeName: string;
		avatarUrl: string;
		message: string;
		edited: boolean;
		editedBy?: string;
		editedAt?: string;
		editedByEmployeeId?: string;
	}>();
	
	for (const message of chatLog[0].messages) {
		if (message.message.originalMessageId) {
			const originalId = message.message.originalMessageId;
			const original = messagesMap.get(originalId);
			if (original) {
				original.message = message.message.message;
				original.edited = true;
				original.editedBy = message.message.editedBy || message.message.editedByEmployeeName;
				original.editedAt = message.message.editedAt;
				if (message.message.editedByEmployeeId) {
					original.editedByEmployeeId = message.message.editedByEmployeeId;
				}
			}
		} else {
			messagesMap.set(message.id, {
				id: message.id,
				employeeId: message.message.employeeId,
				employeeName: message.message.employeeName,
				avatarUrl: message.message.avatarUrl,
				message: message.message.message,
				edited: false
			});
		}
	}
	
	return Array.from(messagesMap.values());
}

export async function editOutlineChatMessage(gameIdStr: string, messageId: string, newMessage: string, editingEmployeeId: string) {
	const gameId = +gameIdStr;
	if (!gameId || isNaN(gameId)) {
		throw new HqError('Invalid game ID', 400, 400);
	}

	if (!messageId || typeof messageId !== 'string') {
		throw new HqError('Invalid message ID', 400, 400);
	}

	if (!newMessage || typeof newMessage !== 'string') {
		throw new HqError('Message cannot be empty', 400, 400);
	}

	const trimmedMessage = newMessage.trim();
	if (trimmedMessage.length === 0 || trimmedMessage.length > MAX_MESSAGE_LENGTH) {
		throw new HqError(`Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters`, 400, 400);
	}

	const decodedMessageId = decodeURIComponent(messageId);
	const streamKey = getOutlineChatKey(gameId);
	
	const allMessages = await redis.xRead(commandOptions({ isolated: true }), [
		{
			key: streamKey,
			id: '0-0'
		}
	], {
		COUNT: 1000
	});
	
	if (!allMessages?.[0]?.messages) {
		throw new HqError('Message not found', 404, 404);
	}
	
	const messagesMap = new Map<string, {
		id: string;
		employeeId: string;
		employeeName: string;
		avatarUrl: string;
		message: string;
		edited: boolean;
		editedBy?: string;
		editedAt?: string;
	}>();
	
	for (const msg of allMessages[0].messages) {
		if (msg.message.originalMessageId) {
			const originalId = msg.message.originalMessageId;
			const original = messagesMap.get(originalId);
			if (original) {
				original.message = msg.message.message;
				original.edited = true;
				original.editedBy = msg.message.editedBy;
				original.editedAt = msg.message.editedAt;
			}
		} else {
			messagesMap.set(msg.id, {
				id: msg.id,
				employeeId: msg.message.employeeId,
				employeeName: msg.message.employeeName,
				avatarUrl: msg.message.avatarUrl,
				message: msg.message.message,
				edited: false
			});
		}
	}
	
	const originalMessageData = messagesMap.get(messageId) || messagesMap.get(decodedMessageId);
	if (!originalMessageData) {
		throw new HqError('Message not found', 404, 404);
	}
	
	if (!originalMessageData.employeeId || !originalMessageData.employeeName || !originalMessageData.avatarUrl) {
		throw new HqError('Invalid message format', 400, 400);
	}
	
	const editingEmployee = await getDiscordUser(editingEmployeeId);
	if (!editingEmployee) {
		throw new HqError('Employee not found', 404, 404);
	}
	
	if (originalMessageData.employeeId !== editingEmployee.id) {
		throw new HqError('You can only edit your own messages', 403, 403);
	}
	
	const editedBy = editingEmployee.name || 'Unknown';
	await redis.xAdd(getOutlineChatKey(gameId), '*', {
		originalMessageId: messageId,
		message: trimmedMessage,
		editedBy: editedBy,
		editedByEmployeeId: editingEmployee.id,
		editedAt: new Date().toISOString()
	});
	
	const editedMessage = constructOutlineChat({
		messageId: messageId,
		employeeId: originalMessageData.employeeId,
		employeeName: originalMessageData.employeeName,
		avatarUrl: originalMessageData.avatarUrl,
		message: trimmedMessage,
		edited: true,
		editedBy: editedBy,
		editedAt: new Date().toISOString(),
		originalMessageId: messageId
	});
	
	try {
		broadcastOutlineChatMessage(gameId, editedMessage);
	} catch (err) {
		logger.error('Failed to broadcast outline chat edit', {
			err,
			gameId,
			messageId,
			errorMessage: err instanceof Error ? err.message : String(err)
		});
	}
	
	return {
		id: messageId,
		employeeId: originalMessageData.employeeId,
		employeeName: originalMessageData.employeeName,
		avatarUrl: originalMessageData.avatarUrl,
		message: trimmedMessage,
		edited: true,
		editedBy: editedBy,
		editedByEmployeeId: editingEmployee.id,
		editedAt: new Date().toISOString()
	};
}

function createSnippet(text: string, searchTerm: string, maxLength: number = 200): string {
	if (!text) return '';
	
	const lowerText = text.toLowerCase();
	const lowerTerm = searchTerm.toLowerCase();
	const termIndex = lowerText.indexOf(lowerTerm);
	
	if (termIndex === -1) {
		return text.length <= maxLength ? text : text.substring(0, maxLength) + '...';
	}
	
	const start = Math.max(0, termIndex - Math.floor((maxLength - searchTerm.length) / 2));
	const end = Math.min(text.length, start + maxLength);
	
	let snippet = text.substring(start, end);
	if (start > 0) snippet = '...' + snippet;
	if (end < text.length) snippet = snippet + '...';
	
	return snippet;
}

export async function searchGamesByContent(searchTerm: string, employeeId: string) {
	if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length === 0) {
		throw new HqError('Search term is required', 0, 400);
	}
	
	const trimmedTerm = searchTerm.trim();
	const lowerTerm = trimmedTerm.toLowerCase();
	
	const permissions = await calculateEmployeePermissionSets(employeeId);
	const hasGameEditPermission = permissions.combined.includes('game.edit');
	
	let accessibleGameIds: number[];
	
	if (hasGameEditPermission) {
		const allGames = await Game.findAll({ attributes: ['gameId'], raw: true });
		accessibleGameIds = allGames.map((g: any) => g.gameId);
	} else {
		const productions = await Production.findAll({
			where: {
				[Op.or]: [
					{ hosts: { [Op.substring]: employeeId } },
					{ writers: { [Op.substring]: employeeId } },
					{ producers: { [Op.substring]: employeeId } }
				]
			},
			attributes: ['id'],
			raw: true
		});
		accessibleGameIds = productions.map((p: any) => +p.id);
	}
	
	if (accessibleGameIds.length === 0) {
		return [];
	}
	
	const outlines = await outline.find({
		gameId: { $in: accessibleGameIds }
	}).exec();
	
	const results: Array<{
		gameId: number;
		itemType: string;
		itemId: number;
		questionNumber?: number;
		puzzleNumber?: number;
		field: string;
		snippet: string;
		fullText: string;
	}> = [];
	
	for (const gameOutline of outlines) {
		if (!gameOutline.outline || !Array.isArray(gameOutline.outline)) continue;
		
		let questionCount = 0;
		let puzzleCount = 0;
		
		for (const item of gameOutline.outline) {
			if (item.itemType === 'question') {
				questionCount++;
				if (item.question) {
					const questionText = item.question;
					if (questionText.toLowerCase().includes(lowerTerm)) {
						results.push({
							gameId: gameOutline.gameId,
							itemType: 'question',
							itemId: item.id,
							questionNumber: questionCount,
							field: 'question',
							snippet: createSnippet(questionText, trimmedTerm),
							fullText: questionText
						});
					}
				}
			}
			
			if (item.itemType === 'puzzle') {
				puzzleCount++;
				if (item.hint && item.hint.toLowerCase().includes(lowerTerm)) {
					results.push({
						gameId: gameOutline.gameId,
						itemType: 'puzzle',
						itemId: item.id,
						puzzleNumber: puzzleCount,
						field: 'hint',
						snippet: createSnippet(item.hint, trimmedTerm),
						fullText: item.hint
					});
				}
				if (item.solution && item.solution.toLowerCase().includes(lowerTerm)) {
					results.push({
						gameId: gameOutline.gameId,
						itemType: 'puzzle',
						itemId: item.id,
						puzzleNumber: puzzleCount,
						field: 'solution',
						snippet: createSnippet(item.solution, trimmedTerm),
						fullText: item.solution
					});
				}
			}
			
			if (item.itemType === 'note' && item.note) {
				const noteText = item.note;
				if (noteText.toLowerCase().includes(lowerTerm)) {
					results.push({
						gameId: gameOutline.gameId,
						itemType: 'note',
						itemId: item.id,
						field: 'note',
						snippet: createSnippet(noteText, trimmedTerm),
						fullText: noteText
					});
				}
			}
		}
	}
	
	return results;
}
