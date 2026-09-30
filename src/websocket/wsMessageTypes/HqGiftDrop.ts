type HqGiftDrop = {
    type: 'giftDrop';
    timeLeftMs: number;
    giftDropId: number;
    itemType: string;
    itemAmount: number;
    giftDropClosed: { giftMessage: string; buttonMessage: string; };
    giftDropOpened: { giftMessage: string; giftInfo: { imageUrl: string; }; };
    openDelayMs: number;
}

export default HqGiftDrop;
