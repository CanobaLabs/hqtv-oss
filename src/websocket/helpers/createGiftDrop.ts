import { featureDb } from '../../common/database/connections';
import GiftDrop from '../../common/database/featureModels/giftDrop';
import GiftDropItem from '../../common/database/featureModels/giftDropItem';
import HqError from '../../common/hqError';

async function createGiftDrop(creatorId: number, createdLive: boolean, items: [string, number, number][]) {
    const validItemTypes = ['extraLives', 'coins', 'erasers', 'superSpins', 'seasonXp', 'empty'];
    if (items.length === 0) {
        throw new HqError(`At least one item required`, 0, 400);
    }
    items.forEach(([itemType]) => {
        if (!validItemTypes.includes(itemType)) {
            throw new HqError(`Invalid item type. Should be one of [${validItemTypes.join(', ')}]`, 0, 400);
        }
    });
    const [giftDrop, giftDropItems] = await featureDb.transaction(async transaction => {
        const giftDrop = await GiftDrop.create({ creatorId, createdLive }, { transaction });
        const giftDropItems = await GiftDropItem.bulkCreate(
            items.map(([itemType, itemQty, itemChance]) => ({
                giftDropId: giftDrop.giftDropId,
                itemType: itemType,
                itemQuantity: itemQty ?? 1,
                itemChance: itemChance ?? 1
            })), { transaction }
        );
        return [giftDrop, giftDropItems]
    });
    
    return {
        giftDrop: giftDrop,
        giftDropItems: giftDropItems
    }
}

export default createGiftDrop;
