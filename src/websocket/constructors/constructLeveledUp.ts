import HqLeveledUp from '../wsMessageTypes/HqLeveledUp';

function constructLeveledUp(levelNumber: number) {
    return {
        type: 'leveledUp',
        currentLevelNumber: levelNumber,
        message: `You leveled up to *Level ${levelNumber}*! You now have a *Free Pass* through Q${levelNumber} in Trivia and *${levelNumber} Bonus Strikes* in Words.`
    } as HqLeveledUp;
}

export default constructLeveledUp;
