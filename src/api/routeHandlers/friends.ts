import { userDb } from '../../common/database/connections';
import FriendRequest from '../../common/database/userModels/friendRequest';
import { FriendRequestStatus } from '../../common/enums';
import HqError from '../../common/hqError';
import logger from '../../common/logger';
import User from '../../common/types/user';
import getFriendIds from '../../common/utils/getFriendIds';
import { getUser } from '../../common/utils/userGetters';
import generateFriendSqlQuery from '../utils/generateFriendSqlQuery';
import getProfileFull from '../utils/profileGetters/getProfileFull';
import renderFriendRequest from '../utils/renderFriendRequest';

export async function getFriendProfiles(userId: number, offset: number = 0, user?: User) {
	const friendIds = await getFriendIds(userId);
    const friendUsers = await Promise.all(
        (friendIds.slice(offset, offset + 20)).map(frId => getUser(frId))
    );
    const data = await Promise.all(
        friendUsers.map(friend => getProfileFull(friend, user))
    );
    return { data: data, count: friendIds.length }
}

export async function getProfileOfFriend(requestedUser: User, requestingUser: User) {
	const friendship = await FriendRequest.findOne({
		where: { accepted: true, ...generateFriendSqlQuery([requestingUser.id, requestedUser.id]) }
	});
	if (!friendship) {
		throw new HqError('A friendship does not exist with a user with that id.', 445, 404);
	}
	const profile = await getProfileFull(requestedUser, requestingUser);
	return profile;
}

export async function removeFriend(friendId: number, requestingUserId: number) {
	const affectedCount = await FriendRequest.destroy({
		where: { accepted: true, ...generateFriendSqlQuery([requestingUserId, friendId]) }
	});
	await Promise.all([
		getFriendIds(requestingUserId, true),
		getFriendIds(friendId, true)
	]);
	logger.info(`Unfriend [ActioningUID=${requestingUserId}, OtherUID=${friendId}]`);
	return { result: !!affectedCount };
}

export async function getAllFriendStatuses(userIdStr: number | string) {
	const [friendIds, incomingFriendRequests, outgoingFriendRequests] = await Promise.all([
        getFriendIds(+userIdStr),
        FriendRequest.findAll({ where: { targetId: userIdStr, accepted: false } }),
        FriendRequest.findAll({ where: { senderId: userIdStr, accepted: false } })
    ]);
    return {
        friendIds: friendIds,
        incomingFriendRequestIds: incomingFriendRequests.map(fr => fr.senderId),
        outgoingFriendRequestIds: outgoingFriendRequests.map(fr => fr.targetId),
    }
}

export async function getFriendshipStatus(userId: number, otherUserId: number) {
	const friendRequest = await FriendRequest.findOne({
		where: { ...generateFriendSqlQuery([userId, otherUserId]) }
	});
	
	type FriendshipStatus = 'FRIENDS' | 'OUTBOUND_REQUEST' | 'INBOUND_REQUEST';
	let friendshipStatus: FriendshipStatus | null = null;
	if (friendRequest?.accepted) {
		friendshipStatus = 'FRIENDS';
	} else if (friendRequest?.senderId === userId) {
		friendshipStatus = 'OUTBOUND_REQUEST';
	} else if (friendRequest?.targetId === userId) {
		friendshipStatus = 'INBOUND_REQUEST';
	}
	return { status: friendshipStatus };
}

export async function changeFriendRequestStatus(userId: number, targetId: number, inputStatus: unknown) {
	const friendReqOptions = Object.values(FriendRequestStatus);
	const friendRequest = await FriendRequest.findOne({
		where: { targetId: userId, senderId: targetId, accepted: false }
	});
	
	const status = inputStatus as FriendRequestStatus;
	if (!friendReqOptions.includes(status)) {
		logger.info(`Invalid friend request status [UID=${userId}, StatusIn=${status}]`);
		throw new HqError(`Received an invalid friend request status. Should be one of [${friendReqOptions.join(', ')}]`, 442, 400);
	} else if (!friendRequest) {
		logger.info(`Friend request not found [UID=${userId}]`);
		throw new HqError('There is no pending friend request between these users', 443, 404);
	}

	logger.info(`Friend request responded to [ResponderUID=${userId}, OtherUID=${friendRequest.senderId}, Status=${status}]`);
	if (inputStatus === FriendRequestStatus.Accepted) {
		await FriendRequest.update({ accepted: 1 }, { where: { friendRequestId: friendRequest.friendRequestId }, limit: 1 });
		await Promise.all([
			// update
			getFriendIds(userId, true),
			getFriendIds(targetId, true)
		]);
	} else if (inputStatus === FriendRequestStatus.Rejected) {
		await FriendRequest.destroy({ where: { friendRequestId: friendRequest.friendRequestId }, limit: 1 });
	}
	return await renderFriendRequest(friendRequest, status);
}

export async function createFriendRequest(fromUserId: number, toUserId: number) {
	return await userDb.transaction(async transaction => {
		const existFriendRequest = await FriendRequest.findOne({
			where: { ...generateFriendSqlQuery([fromUserId, toUserId]) },
			transaction
		});
		if (fromUserId === toUserId) {
			logger.info(`Tried sending friend request to self [UID=${fromUserId}]`);
			throw new HqError('You can\'t send a friend request to yourself.', 444, 400);
		} else if (existFriendRequest?.accepted) {
			logger.info(`The users are already friends [UID=${fromUserId}, TargetID=${toUserId}]`);
			throw new HqError('The users are already friends', 441, 400);
		} else if (existFriendRequest) {
			logger.info(`There is already an open friend request [UID=${fromUserId}, TargetID=${toUserId}]`);
			throw new HqError('There is already an open friend request between those users', 440, 400);
		}
		
		const newFriendRequest = await FriendRequest.create({
			senderId: fromUserId,
			targetId: toUserId
		}, { transaction });
		logger.info(`Friend request sent [SenderID=${newFriendRequest.senderId}, TargetID=${newFriendRequest.targetId}]`);
		return await renderFriendRequest(newFriendRequest);
	});
}

export async function cancelOutboundFriendRequest(userId: number, targetUserId: number) {
	const affectedCount = await FriendRequest.destroy({
		where: {
			senderId: userId,
			targetId: targetUserId,
			accepted: false
		},
		limit: 1
	});
	logger.info(`Outbound friend request cancelled [SenderID=${userId}, TargetID=${targetUserId}]`);
	return { result: !!affectedCount }; // send as bool
}

export async function getIncomingFriendRequests(userId: number, offset: number = 0) {
	const [incomingFriendRequests, incomingRequestsCount] = await Promise.all([
        FriendRequest.findAll({
            where: { targetId: userId, accepted: false },
            offset: offset,
            limit: 20
        }),
        FriendRequest.count({ where: { targetId: userId, accepted: false } })
    ]);

    const data = await Promise.all(
        incomingFriendRequests.map(friendReq => renderFriendRequest(friendReq))
    );
	return { data, count: incomingRequestsCount };
}
