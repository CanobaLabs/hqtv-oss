class ApiShowLive {
    broadcastId: number;
    socketUrl: string;
    streams: { source: string; passthrough: string; high: string; medium: string; low: string; };
    playlistUrl: string;
    gameKey: string;
    unbounded: boolean;
    atCapacity: boolean;
    constructor(broadcastId: number, gameKey: string, socketUrl: string, source: string, passthrough: string, high: string, medium: string, low: string, playlistUrl: string, unbounded: boolean) {
        this.broadcastId = broadcastId;
        this.socketUrl = socketUrl;
        this.streams = {
            source: source,
            passthrough: passthrough,
            high: high,
            medium: medium,
            low: low
        };
        this.playlistUrl = playlistUrl;
        this.gameKey = gameKey;
        this.unbounded = unbounded;
        this.atCapacity = false;
    }
}

export default ApiShowLive;
