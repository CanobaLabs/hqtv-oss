import GiftDrop from '../../common/database/featureModels/giftDrop';
import GiftDropItem from '../../common/database/featureModels/giftDropItem';
import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import rGameKey from '../wsTypes/redisGameKeys';
import WsGameInfo from '../wsTypes/WsGameInfo';
import createGiftDrop from '../helpers/createGiftDrop';
import CrossServer from '../helpers/CrossServer';

async function masterGiftDropHandler(gameInfo: WsGameInfo, broadcastId: number, addGiftDrop: { new: [string, number, number][]; } | { giftDropId: number; }) {
    let giftDropId: number;
    if ('new' in addGiftDrop) {
        const { giftDrop } = await createGiftDrop(0, true, addGiftDrop.new);
        giftDropId = giftDrop.giftDropId;
    } else if ('giftDropId' in addGiftDrop) {
        giftDropId = addGiftDrop.giftDropId;
    } else {
        throw new HqError('giftDropId required', 0, 400);
    }
    
    const [giftDrop, giftDropItems, playerIds] = await Promise.all([
        GiftDrop.findOne({ where: { giftDropId } }),
        GiftDropItem.findAll({ where: { giftDropId } }),
        redis.zRange(rGameKey(broadcastId).connected, '-inf', '+inf', { BY: 'SCORE' }) // only gift to players that are watching
    ]);
    if (!giftDrop) {
        throw new HqError('Gift drop does not exist', 0, 400);
    }

    const cumulativeChance = giftDropItems.reduce((total, curr) => total + curr.itemChance, 0);
    function getRandomGiftDropItem() {
        const random = Math.random() * cumulativeChance;
        let chanceSum = 0;
        for (const item of giftDropItems) {
            chanceSum += item.itemChance;
            if (random <= chanceSum) {
                return item;
            }
        }
        return giftDropItems[0];
    }
    const multi = redis.multi()
        .sAdd(rGameKey(broadcastId).giftDropIds, giftDropId.toString());
    playerIds.forEach(plrId => {
        const randomItem = getRandomGiftDropItem();
        multi.hSet(rGameKey(broadcastId).giftDrop(giftDropId), plrId, JSON.stringify(
            [randomItem.itemType, randomItem.itemQuantity]
        ));
    });
    await multi.exec();
    await CrossServer.sendAllServers('giftDrop', broadcastId, { giftDropId });

    return {
        giftDrop,
        giftDropItems
    }
}

export default masterGiftDropHandler;
