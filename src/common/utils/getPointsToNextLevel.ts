import LevelInfo from '../types/level';

function getPointsToNextLevel(levels: LevelInfo[], currentXp: number, currentLevelNum: number): number {
    const nextLevel = levels.find(l => l.level == currentLevelNum + 1);
    return nextLevel ? nextLevel.minPoints - currentXp : 0;
}

export default getPointsToNextLevel;
