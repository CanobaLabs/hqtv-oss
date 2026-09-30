import redis from '../redisClient';
import rKey from '../redisKeys';
import { outline } from '../mongoClient';
import TriviaGameMeta from '../database/eventModels/triviaGameMeta';
import WordsGameMeta from '../database/eventModels/wordsGameMeta';
import SuperWheelItem from '../database/featureModels/superWheelItem';
import Game from '../database/eventModels/game';
import Broadcast from '../database/eventModels/broadcast';

export async function getCachedOutline(gameId: number): Promise<{ outline: any[] } | null> {
    try {
        const cached = await redis.get(rKey.gameOutline(gameId));
        if (cached) {
            const parsed = JSON.parse(cached);
            return parsed;
        }
        
        const gameOutline = await outline.findOne({ gameId }).exec();
        if (!gameOutline) {
            return null;
        }
        
        const result = { outline: gameOutline.outline || [] };
        await redis.set(rKey.gameOutline(gameId), JSON.stringify(result)).catch(() => {});
        return result;
    } catch (err) {
        const gameOutline = await outline.findOne({ gameId }).exec();
        return gameOutline ? { outline: gameOutline.outline || [] } : null;
    }
}

export async function cacheOutline(gameId: number, outlineData: { outline: any[] }): Promise<void> {
    await redis.set(rKey.gameOutline(gameId), JSON.stringify(outlineData)).catch(() => {});
}

export async function invalidateOutlineCache(gameId: number): Promise<void> {
    await redis.del(rKey.gameOutline(gameId)).catch(() => {});
}

export async function getCachedTriviaGameMeta(gameId: string): Promise<TriviaGameMeta | null> {
    try {
        const cached = await redis.get(rKey.triviaGameMeta(gameId));
        if (cached) {
            return JSON.parse(cached);
        }
        
        const meta = await TriviaGameMeta.findOne({ where: { gameId } });
        if (meta) {
            const metaData = meta.toJSON ? meta.toJSON() : meta;
            await redis.set(rKey.triviaGameMeta(gameId), JSON.stringify(metaData)).catch(() => {});
        }
        return meta;
    } catch (err) {
        return await TriviaGameMeta.findOne({ where: { gameId } });
    }
}

export async function invalidateTriviaGameMetaCache(gameId: string): Promise<void> {
    await redis.del(rKey.triviaGameMeta(gameId)).catch(() => {});
}

export async function getCachedWordsGameMeta(gameId: string): Promise<WordsGameMeta | null> {
    try {
        const cached = await redis.get(rKey.wordsGameMeta(gameId));
        if (cached) {
            return JSON.parse(cached);
        }
        
        const meta = await WordsGameMeta.findOne({ where: { gameId } });
        if (meta) {
            const metaData = meta.toJSON ? meta.toJSON() : meta;
            await redis.set(rKey.wordsGameMeta(gameId), JSON.stringify(metaData)).catch(() => {});
        }
        return meta;
    } catch (err) {
        return await WordsGameMeta.findOne({ where: { gameId } });
    }
}

export async function invalidateWordsGameMetaCache(gameId: string): Promise<void> {
    await redis.del(rKey.wordsGameMeta(gameId)).catch(() => {});
}

export async function getCachedSuperWheelItems(): Promise<SuperWheelItem[]> {
    try {
        const cached = await redis.get(rKey.superWheelItems);
        if (cached) {
            return JSON.parse(cached);
        }
        
        const items = await SuperWheelItem.findAll();
        await redis.set(rKey.superWheelItems, JSON.stringify(items.map(item => item.toJSON ? item.toJSON() : item))).catch(() => {});
        return items;
    } catch (err) {
        return await SuperWheelItem.findAll();
    }
}

export async function invalidateSuperWheelItemsCache(): Promise<void> {
    await redis.del(rKey.superWheelItems).catch(() => {});
}

export async function getCachedGame(gameId: string): Promise<Game | null> {
    try {
        const cached = await redis.get(rKey.apGame(gameId));
        if (cached) {
            const parsed = JSON.parse(cached);
            // Convert plain object back to Game instance if needed
            return parsed as any;
        }
        
        const game = await Game.findOne({ where: { gameId }, raw: true });
        if (game) {
            await redis.set(rKey.apGame(gameId), JSON.stringify(game)).catch(() => {});
        }
        return game as any;
    } catch (err) {
        const game = await Game.findOne({ where: { gameId }, raw: true });
        return game as any;
    }
}

export async function getCachedBroadcast(broadcastId: number): Promise<Broadcast | null> {
    try {
        const cached = await redis.get(rKey.broadcast(broadcastId));
        if (cached) {
            return JSON.parse(cached);
        }
        
        const broadcast = await Broadcast.findByPk(broadcastId);
        if (broadcast) {
            const broadcastData = broadcast.toJSON ? broadcast.toJSON() : broadcast;
            await redis.set(rKey.broadcast(broadcastId), JSON.stringify(broadcastData)).catch(() => {});
        }
        return broadcast;
    } catch (err) {
        return await Broadcast.findByPk(broadcastId);
    }
}

export async function invalidateBroadcastCache(broadcastId: number): Promise<void> {
    await redis.del(rKey.broadcast(broadcastId)).catch(() => {});
}
