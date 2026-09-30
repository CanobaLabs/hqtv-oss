import getFriendIds from '../../common/utils/getFriendIds';

async function getFriendIdsAsStr(playerId: string) {
    const friendIds = await getFriendIds(+playerId);
    return friendIds.map(frId => frId.toString())
}

export default getFriendIdsAsStr;
