type HqStreak = {
    type: 'streak';
    target: number;
    current: number;
    status: 'inProgress' | 'completed';
}

export default HqStreak;
