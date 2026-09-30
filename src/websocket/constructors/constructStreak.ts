import HqStreak from '../wsMessageTypes/HqStreak';

function constructStreak(target: number, current: number) {
    let status: 'inProgress' | 'completed' = 'inProgress';
    if (current >= target) status = 'completed';
    return {
        type: 'streak',
        target,
        current,
        status
    } as HqStreak;
}

export default constructStreak;
