import HqDynamicPotAnimation from '../wsMessageTypes/HqDynamicPotAnimation';

function constructDynamicPotAnimation(prizeCents: number, prizePoints: number) {
    return {
        type: 'dynamicPotAnimation',
        currentPrizeCents: prizeCents,
        currentPrizePoints: prizePoints
    } as HqDynamicPotAnimation;
}

export default constructDynamicPotAnimation;
