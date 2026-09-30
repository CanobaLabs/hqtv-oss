import redis from '../../common/redisClient';
import checkpointMethods from './CheckpointMethods';
import rGameKey from '../wsTypes/redisGameKeys';

type CheckpointStatus = 'notStarted' | 'decision' | 'results' | 'complete';

async function getCheckpointStatus(broadcastId: number, checkpointId: string): Promise<CheckpointStatus> {
    const { currentCheckpoint } = await checkpointMethods(broadcastId).getCheckpointInfo(checkpointId);
    
    if (!currentCheckpoint) {
        return 'notStarted';
    }
    
    const offerStarted = currentCheckpoint.offerStarted;
    if (!offerStarted) {
        return 'notStarted';
    }
    
    const summarySent = await redis.hGet(rGameKey(broadcastId).checkpoint(checkpointId).cp, 'summarySent');
    
    if (!summarySent) {
        return 'decision';
    }
    
    const summarySentTime = +summarySent;
    const now = Date.now();
    const elapsed = now - summarySentTime;
    
    if (elapsed >= 10000) {
        return 'complete';
    } else {
        return 'results';
    }
}

export default getCheckpointStatus;
export type { CheckpointStatus };

