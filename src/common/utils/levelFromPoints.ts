import LevelInfo from '../types/level';

function levelFromPoints(points: number, levels: LevelInfo[]) {
    let userLevel = levels[0];
    for (let i = levels.length - 1; i >= 0; i--) {
        // loop in reverse
        if (points >= levels[i].minPoints) {
            userLevel = levels[i];
            break;
        }
    }
    return {
        level: userLevel?.level ?? 0,
        minPoints: userLevel?.minPoints ?? 0,
        maxPoints: userLevel?.maxPoints ?? 0
    };
}

export default levelFromPoints;
