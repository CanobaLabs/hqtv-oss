class ApiAnnouncement {
    active: boolean;
    type: string;
    vertical: string;
    gameType: string;
    bgImageUrl: string;
    bgVideoUrl: string;
    width: number;
    height: number;
    constructor(imageUrl: string, width: number = 1366, height: number = 768) {
        this.active = true;
        this.type = 'referral';
        this.vertical = 'general';
        this.gameType = 'trivia';
        this.bgImageUrl = imageUrl;
        this.bgVideoUrl = imageUrl;
        this.width = width;
        this.height = height;
    }
}

export default ApiAnnouncement;
