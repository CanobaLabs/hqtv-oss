import { FriendRequestStatus } from '../../common/enums';
import FriendRequest from '../../common/database/userModels/friendRequest';
import getProfilePartialWithCreated from './profileGetters/getProfilePartialWithCreated';
import { getUser } from '../../common/utils/userGetters';

async function renderFriendRequest(friendRequest: FriendRequest, newStatus?: FriendRequestStatus) {
    const [sender, recipient] = await Promise.all([
        getUser(friendRequest.senderId),
        getUser(friendRequest.targetId)
    ]);
    return {
        status: newStatus ?? FriendRequestStatus.Pending,
        created: friendRequest.createDate.getTime(),
        requestingUser: sender ? getProfilePartialWithCreated(sender) : null,
        requestedUser: recipient ? getProfilePartialWithCreated(recipient) : null,
    }
}

export default renderFriendRequest;
