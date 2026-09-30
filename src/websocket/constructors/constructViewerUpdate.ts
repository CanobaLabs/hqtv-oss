import User from '../../common/types/user';
import HqViewerUpdate from '../wsMessageTypes/HqViewerUpdate';

function constructViewerUpdate(user: User, viewerState: 'playing' | 'watching' | 'disconnected') {
    return {
        type: 'viewerUpdate',
        userId: user.id,
        username: user.dispName,
        avatarUrl: user.avatarUrl,
        viewerState: viewerState
    } as HqViewerUpdate;
}

export default constructViewerUpdate;
