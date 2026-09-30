type HqShowWheel = {
    type: 'showWheel';
    showId: number;
    roundId: number;
    letters: string;
    superWheel: { name: string; letters: string; extraLives: number; }[];
    superSpins: number;
}

export default HqShowWheel;
