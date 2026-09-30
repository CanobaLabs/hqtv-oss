type HqViewerUpdate = {
    type: 'viewerUpdate';
    userId: number;
    username: string;
    avatarUrl: string;
    viewerState: 'playing' | 'watching' | 'disconnected';
}

export default HqViewerUpdate;
