import redis from '../../common/redisClient';
import HqWebSocket from '../wsTypes/HqWebSocket';
import rGameKey from '../wsTypes/redisGameKeys';
import HqGiftDrop from '../wsMessageTypes/HqGiftDrop';

async function constructGiftDrop(giftDropId: number, { playerId, broadcastId }: HqWebSocket['player']) {
    const giftDropItem = await redis.hGet(rGameKey(broadcastId).giftDrop(giftDropId), playerId);
    if (!giftDropItem) return;

    const [item, qty] = JSON.parse(giftDropItem);
    let itemType = item, giftOpenMessage = '', customImageUrl: string | undefined;
    if (item === 'extraLives') {
        if (qty === 1) {
            giftOpenMessage = 'An extra life!';
        } else {
            giftOpenMessage = `${qty.toLocaleString('en-US')} extra lives!`
        }
    } else if (item === 'coins') {
        if (qty === 1) {
            giftOpenMessage = `${qty.toLocaleString('en-US')} coin 😂`;
        } else {
            giftOpenMessage = `${qty.toLocaleString('en-US')} coins!`
        }
    } else if (item === 'erasers') {
        itemType = 'custom';
        customImageUrl = process.env.CDN_URL + '/hqtv/eraser.png';
        if (qty === 1) {
            giftOpenMessage = 'An eraser!';
        } else {
            giftOpenMessage = `${qty.toLocaleString('en-US')} erasers!`
        }
    } else if (item === 'superSpins') {
        itemType = 'custom';
        customImageUrl = process.env.CDN_URL + '/hqtv/superspin.png';
        if (qty === 1) {
            giftOpenMessage = 'A super spin!';
        } else {
            giftOpenMessage = `${qty.toLocaleString('en-US')} super spins!`
        }
    } else if (item === 'seasonXp') {
        itemType = 'custom';
        customImageUrl = process.env.CDN_URL + '/hqtv/seasonxp.png';
        if (qty === 1) {
            giftOpenMessage = `${qty.toLocaleString('en-US')} point!`;
        } else {
            giftOpenMessage = `${qty.toLocaleString('en-US')} points!`
        }
    } else if (item === 'empty') {
        giftOpenMessage = 'Empty :('
    }
    return {
        type: 'giftDrop',
        timeLeftMs: 10000,
        giftDropId: giftDropId,
        itemType: itemType,
        itemAmount: qty,
        giftDropClosed: { giftMessage: 'You got a box!', buttonMessage: 'Open it' },
        giftDropOpened: { giftMessage: giftOpenMessage, giftInfo: { imageUrl: customImageUrl } },
        openDelayMs: 3000
    } as HqGiftDrop;
}

export default constructGiftDrop;
